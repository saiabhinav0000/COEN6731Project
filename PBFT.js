/* jshint globalstrict: true */
/* jshint browser: true */
/* jshint devel: true */
/* jshint jquery: true */
/* global util */
'use strict';

var pbft = {};
var RPC_TIMEOUT = 50000;
var MIN_RPC_LATENCY = 10000;
var MAX_RPC_LATENCY = 15000;
var VIEW_CHANGE_TIMEOUT = 100000; // Reduced to make view changes more visible
var NUM_SERVERS = 5; // At least 3f+1 where f=1
var BATCH_SIZE = 1;
var CLIENT_NODE_ID = 6; // 1-5 are regular nodes, 6 is client

// PBFT specific constants
var PRE_PREPARE_PHASE = 'pre-prepare';
var PREPARE_PHASE = 'prepare';
var COMMIT_PHASE = 'commit';
var REPLY_PHASE = 'reply';

// Auto-request configuration
var AUTO_REQUESTS_ENABLED = true;    // Enable automatic client requests
var AUTO_REQUEST_INTERVAL = 800000;  // Time between auto requests (in microseconds)
var lastAutoRequestTime = 0;         // Last time an auto request was sent

// View change backoff tracking
var viewChangeBackoff = {};          // Track consecutive view changes for exponential backoff

(function() {

// Message sending functions
var sendMessage = function(model, message) {
  message.sendTime = model.time;
  // Default receive time if not specified
  if (!message.recvTime) {
    message.recvTime = model.time +
                       MIN_RPC_LATENCY +
                       Math.random() * (MAX_RPC_LATENCY - MIN_RPC_LATENCY);
  }
  model.messages.push(message);
};

var sendRequest = function(model, request) {
  request.direction = 'request';
  sendMessage(model, request);
};

var sendReply = function(model, request, reply) {
  reply.from = request.to;
  reply.to = request.from;
  reply.type = request.type;
  reply.direction = 'reply';
  sendMessage(model, reply);
};

// Compute digest of a message (simplified)
var computeDigest = function(message) {
  // In a real implementation, this would use a cryptographic hash function
  return 'digest_' + JSON.stringify(message).length;
};

// Rules for the PBFT protocol
var rules = {};
pbft.rules = rules;

// Get primary based on view number
var getPrimaryForView = function(view) {
  return (view % NUM_SERVERS) + 1;
};

// Modified for balanced view change timeouts
var makeViewAlarm = function(now, serverId) {
  var baseTimeout = VIEW_CHANGE_TIMEOUT;
  
  // If no previous view changes for this server, use default timeout
  if (!serverId || !viewChangeBackoff[serverId]) {
    if (serverId) viewChangeBackoff[serverId] = 1;
    return now + baseTimeout * (0.9 + Math.random() * 0.2);
  }
  
  // Apply moderate backoff to prevent cascading view changes
  var backoff = Math.min(viewChangeBackoff[serverId], 3);
  viewChangeBackoff[serverId] *= 1.5;  // Increase backoff for next time
  return now + baseTimeout * backoff * (0.9 + Math.random() * 0.2);
};

// PBFT server state
pbft.server = function(id, peers) {
  return {
    id: id,
    peers: peers,
    state: 'follower',
    view: 0,
    term: 1,
    log: [],
    commitIndex: 0,
    prepareMessages: {}, // indexed by sequence number
    commitMessages: {}, // indexed by sequence number
    sequenceNumber: 0,
    viewChangeTimeout: VIEW_CHANGE_TIMEOUT,
    viewAlarm: makeViewAlarm(0, id),
    isPrimary: false,
    checkpoints: {},
    lastStableCheckpoint: 0,
    viewChangeVotes: util.makeMap(peers, false),
  };
};

// PBFT client state
pbft.client = function(id, servers) {
  return {
    id: id,
    servers: servers,
    requestTimeout: 100000,
    requestNumber: 0,
    pendingRequests: {},
    replies: {},
    currentPrimary: 1,  // Default to server 1 as initial primary
    view: 0             // Track the current view number
  };
};

// Phase 1: Pre-prepare (primary broadcasts client request)
rules.sendPrePrepare = function(model, server) {
  if (server.state === 'leader' && 
      model.pendingClientRequest &&
      !model.pendingClientRequest.processed) {
    
    // Make absolutely sure we don't process until the delay has elapsed
    // This is critical for visualization purposes
    if (model.pendingClientRequest.processAfter && 
        model.time < model.pendingClientRequest.processAfter) {
      return; // Wait until the client request has been visible for a while
    }
    
    // Only process if this server is the request's target primary
    if (!model.pendingClientRequest.primary || 
        model.pendingClientRequest.primary === server.id) {
      
      var request = model.pendingClientRequest;
      var digest = computeDigest(request);
      
      console.log("Primary " + server.id + " sending pre-prepare for request in view " + server.view);
      
      // Assign sequence number
      server.sequenceNumber += 1;
      var n = server.sequenceNumber;
      
      model.pendingClientRequest.processed = true;
      
      // Send pre-prepare to all backups
      server.peers.forEach(function(peer) {
        sendRequest(model, {
          from: server.id,
          to: peer,
          type: 'PrePrepare',
          view: server.view,  // Always use current view
          sequenceNumber: n,
          digest: digest,
          request: request,
          term: server.term,
          // Use staggered timing to make messages visibly sequential
          recvTime: model.time + MIN_RPC_LATENCY * 1.5
        });
      });
      
      // Add to log
      server.log.push({
        term: server.term,
        request: request,
        sequenceNumber: n,
        phase: PRE_PREPARE_PHASE
      });
    }
  }
};

// Phase 2: Prepare (replicas broadcast prepare messages)
rules.sendPrepare = function(model, server, preprepareMsg) {
  if (server.state !== 'stopped' && preprepareMsg.view === server.view) {
    var n = preprepareMsg.sequenceNumber;
    var digest = preprepareMsg.digest;
    
    console.log("Server " + server.id + " sending prepare messages for seq " + n);
    
    // Add this server's own prepare message to prepareMessages
    if (!server.prepareMessages[n]) {
      server.prepareMessages[n] = {};
    }
    server.prepareMessages[n][server.id] = digest;
    
    // Add to log
    server.log.push({
      term: server.term,
      request: preprepareMsg.request,
      sequenceNumber: n,
      phase: PREPARE_PHASE
    });
    
    // Reset view alarm when receiving a valid pre-prepare
    resetViewAlarm(model, server);
    
    // Send prepare to all other replicas with a slight delay
    server.peers.forEach(function(peer) {
      sendRequest(model, {
        from: server.id,
        to: peer,
        type: 'Prepare',
        view: server.view,
        sequenceNumber: n,
        digest: digest,
        term: server.term,
        recvTime: model.time + MIN_RPC_LATENCY * 2
      });
    });
    
    // Check if this node already has enough prepare messages (including its own)
    rules.checkPrepareQuorum(model, server, n, digest);
  }
};

// Phase 3: Commit (replicas broadcast commit messages)
rules.sendCommit = function(model, server, sequenceNumber, digest) {
  if (server.state !== 'stopped') {
    console.log("Server " + server.id + " sending commit messages for seq " + sequenceNumber);
    
    // Record our own commit message
    if (!server.commitMessages[sequenceNumber]) {
      server.commitMessages[sequenceNumber] = {};
    }
    server.commitMessages[sequenceNumber][server.id] = digest;
    
    // Add to log
    var logEntry = server.log.find(function(entry) { 
      return entry.sequenceNumber === sequenceNumber; 
    });
    
    if (logEntry) {
      logEntry.phase = COMMIT_PHASE;
    }
    
    // Send commit to all replicas with an additional delay
    server.peers.forEach(function(peer) {
      sendRequest(model, {
        from: server.id,
        to: peer,
        type: 'Commit',
        view: server.view,
        sequenceNumber: sequenceNumber,
        digest: digest,
        term: server.term,
        recvTime: model.time + MIN_RPC_LATENCY * 2.5
      });
    });
    
    // Check if this node already has enough commit messages (including its own)
    rules.checkCommitQuorum(model, server, sequenceNumber, digest);
  }
};

// Phase 4: Reply (all replicas send reply to client)
rules.sendReply = function(model, server, sequenceNumber) {
  if (server.state !== 'stopped') {
    console.log("Server " + server.id + " sending reply for seq " + sequenceNumber);
    
    var logEntry = server.log.find(function(entry) { 
      return entry.sequenceNumber === sequenceNumber; 
    });
    
    if (logEntry) {
      // Mark as executed in log
      logEntry.phase = REPLY_PHASE;
      
      // Send reply to client
      if (model.client) {
        sendRequest(model, {
          from: server.id,
          to: CLIENT_NODE_ID,
          type: 'Reply',
          view: server.view,
          sequenceNumber: sequenceNumber,
          result: 'executed_' + sequenceNumber,
          term: server.term,
          recvTime: model.time + MIN_RPC_LATENCY * 3
        });
      }
    }
  }
};

// Help stop unnecessary view changes by resetting timers on message receipt
var resetViewAlarm = function(model, server) {
  if (server.state !== 'stopped') {
    // Reset timer with longer timeout
    server.viewAlarm = model.time + VIEW_CHANGE_TIMEOUT * 1.2;
    
    // Gradually reduce backoff factor when regular messages are flowing
    if (viewChangeBackoff[server.id]) {
      viewChangeBackoff[server.id] = Math.max(1, viewChangeBackoff[server.id] * 0.7);
    }
  }
};

// View change (when primary is suspected to be faulty)
rules.initiateViewChange = function(model, server) {
  // Only initiate a view change if:
  // 1. The server is not stopped
  // 2. The view alarm has expired
  if (server.state !== 'stopped' && server.viewAlarm <= model.time) {
    var primaryId = getPrimaryForView(server.view);
    
    // Only proceed with view change if:
    // 1. Explicitly forced via server.forceViewChange flag
    // OR
    // 2. There's a pending client request AND primary appears unresponsive
    var forcedChange = server.forceViewChange === true;
    var hasPendingRequest = model.pendingClientRequest && !model.pendingClientRequest.processed;
    
    // Check if primary is responsive (only if there's a pending request)
    var primaryUnresponsive = false;
    if (hasPendingRequest && primaryId !== server.id) {
      // Look for recent activity from primary
      var recentPrimaryActivity = model.messages.some(function(m) {
        return m.from === primaryId && 
               (model.time - m.sendTime < VIEW_CHANGE_TIMEOUT * 0.7);
      });
      primaryUnresponsive = !recentPrimaryActivity;
    }
    
    if (forcedChange || (hasPendingRequest && primaryUnresponsive)) {
      console.log("Server " + server.id + " initiating view change from view " + server.view + 
                 (forcedChange ? " (forced)" : " (primary unresponsive)"));
      
      // Clear force flag if it was set
      server.forceViewChange = false;
      
      server.view += 1;
      server.viewAlarm = makeViewAlarm(model.time, server.id);
      
      // Send view change to all other replicas
      server.peers.forEach(function(peer) {
        sendRequest(model, {
          from: server.id,
          to: peer,
          type: 'ViewChange',
          newView: server.view,
          lastSequence: server.sequenceNumber,
          term: server.term,
          // Make view change messages travel faster for visualization
          recvTime: model.time + MIN_RPC_LATENCY * 0.8
        });
      });
      
      // Reset votes for the new view
      server.viewChangeVotes = util.makeMap(server.peers, false);
      server.viewChangeVotes[server.id] = true; // Vote for self
      
      // Process own vote
      rules.processViewChange(model, server, {
        from: server.id,
        newView: server.view
      });
    } else {
      // No reason to change view, reset timer
      server.viewAlarm = makeViewAlarm(model.time, server.id);
    }
  }
};

// Process view change messages
rules.processViewChange = function(model, server, msg) {
  // Only process view changes for higher views
  if (server.view < msg.newView) {
    console.log("Server " + server.id + " updating view from " + server.view + " to " + msg.newView);
    server.view = msg.newView;
    server.viewAlarm = makeViewAlarm(model.time, server.id);
    
    // Clear old vote records and start fresh
    server.viewChangeVotes = util.makeMap(server.peers, false);
    server.viewChangeVotes[server.id] = true;
    
    // Clear message counters
    server.prepareMessages = {};
    server.commitMessages = {};
    
    // Update state
    server.state = 'follower';
    server.isPrimary = false;
  }
  
  // Count votes for current view
  if (msg.newView === server.view) {
    server.viewChangeVotes[msg.from] = true;
  }
  
  // Count total votes for this view
  var voteCount = 0;
  for (var id in server.viewChangeVotes) {
    if (server.viewChangeVotes[id]) {
      voteCount++;
    }
  }
  
  console.log("Server " + server.id + " has " + voteCount + " votes for view " + server.view);
  
  // Need a majority (> N/2) votes to become primary
  if (voteCount > Math.floor(NUM_SERVERS / 2)) {
    var correctPrimaryId = getPrimaryForView(server.view);
    
    // If I should be the primary for this view
    if (correctPrimaryId === server.id) {
      console.log("Server " + server.id + " becoming primary for view " + server.view);
      
      // Force any other incorrect primaries to step down
      model.servers.forEach(function(s) {
        if (s.state !== 'stopped' && s.isPrimary && s.id !== server.id) {
          console.log("Forcing incorrect primary S" + s.id + " to step down");
          s.isPrimary = false;
          s.state = 'follower';
        }
      });
      
      // Become primary
      server.state = 'leader';
      server.isPrimary = true;
      
      // Broadcast new view message
      server.peers.forEach(function(peer) {
        sendRequest(model, {
          from: server.id,
          to: peer,
          type: 'NewView',
          view: server.view,
          term: server.term
        });
      });
      
      // Reset backoff when successfully becoming a primary
      viewChangeBackoff[server.id] = 1;
      
      // Redirect any pending client request
      if (model.pendingClientRequest && !model.pendingClientRequest.processed) {
        model.pendingClientRequest.primary = server.id;
      }
    }
  }
};

// Check prepare quorum and send commit if reached
// Check prepare quorum and send commit if reached
rules.checkPrepareQuorum = function(model, server, sequenceNumber, digest) {
  if (!server.prepareMessages[sequenceNumber]) return;
  
  // Count prepare messages for this sequence number and digest
  var count = 0;
  for (var id in server.prepareMessages[sequenceNumber]) {
    if (server.prepareMessages[sequenceNumber][id] === digest) {
      count++;
    }
  }
  
  console.log("Server " + server.id + " has " + count + " prepare messages for seq " + sequenceNumber);
  
  // Calculate f as Math.floor((NUM_SERVERS - 1) / 3)
  var f = Math.floor((NUM_SERVERS - 1) / 3);
  // We need 2f+1 prepare messages (including our own)
  // With 5 servers and f=1, we need 3 prepare messages
  if (count >= 2 * f + 1) {
    console.log("Server " + server.id + " reached prepare quorum for seq " + sequenceNumber);
    rules.sendCommit(model, server, sequenceNumber, digest);
  }
};

// Check commit quorum and execute if reached
rules.checkCommitQuorum = function(model, server, sequenceNumber, digest) {
  if (!server.commitMessages[sequenceNumber]) return;
  
  // Count commit messages for this sequence number and digest
  var count = 0;
  for (var id in server.commitMessages[sequenceNumber]) {
    if (server.commitMessages[sequenceNumber][id] === digest) {
      count++;
    }
  }
  
  console.log("Server " + server.id + " has " + count + " commit messages for seq " + sequenceNumber);
  
  // Calculate f as Math.floor((NUM_SERVERS - 1) / 3)
  var f = Math.floor((NUM_SERVERS - 1) / 3);
  // We need 2f+1 commit messages (including our own)
  // With 5 servers and f=1, we need 3 commit messages
  if (count >= 2 * f + 1) {
    console.log("Server " + server.id + " reached commit quorum for seq " + sequenceNumber);
    
    // Execute request and reply to client
    server.commitIndex = Math.max(server.commitIndex, sequenceNumber);
    rules.sendReply(model, server, sequenceNumber);
  }
};

// Main update function for PBFT
pbft.update = function(model) {
  // First, initialize client if it doesn't exist
  if (!model.client && model.servers.length > 0) {
    var serverIds = model.servers.map(function(server) { return server.id; });
    model.client = pbft.client(CLIENT_NODE_ID, serverIds);
  }
  
  // Handle client behavior - automatic requests
  if (model.client && !model.pendingClientRequest && AUTO_REQUESTS_ENABLED) {
    // Send an automatic request if enough time has passed
    if (model.time - lastAutoRequestTime > AUTO_REQUEST_INTERVAL) {
      // Find the current primary
      var primary = model.servers.find(function(s) { 
        return s.state === 'leader' && s.isPrimary; 
      });
      
      if (primary) {
        lastAutoRequestTime = model.time;
        pbft.clientRequest(model);
      }
    }
  }
  
  // Process servers
  model.servers.forEach(function(server) {
    // Check for view change timeout
    rules.initiateViewChange(model, server);
    
    // Send pre-prepare if primary
    if (server.state === 'leader') {
      rules.sendPrePrepare(model, server);
    }
  });
  
  // Deliver messages
  var deliver = [];
  var keep = [];
  
  model.messages.forEach(function(message) {
    if (message.recvTime <= model.time)
      deliver.push(message);
    else if (message.recvTime < util.Inf)
      keep.push(message);
  });
  
  model.messages = keep;
  
  deliver.forEach(function(message) {
    model.servers.forEach(function(server) {
      if (server.id === message.to) {
        handleMessage(model, server, message);
      }
    });
    
    // Handle messages for client
    if (model.client && message.to === model.client.id) {
      handleClientMessage(model, model.client, message);
    }
  });
};

// Handle client messages
var handleClientMessage = function(model, client, message) {
  if (message.type === 'Reply') {
    if (!client.replies[message.sequenceNumber]) {
      client.replies[message.sequenceNumber] = {};
    }
    
    client.replies[message.sequenceNumber][message.from] = message.result;
    
    console.log("Client received reply from S" + message.from + " for seq " + message.sequenceNumber);
    
    // Update client's knowledge of primary if view changes
    if (message.view > client.view) {
      client.view = message.view;
      client.currentPrimary = getPrimaryForView(message.view);
      console.log("Client updated primary to " + client.currentPrimary + " based on view " + message.view);
    }
    
    // Count matching replies
    var counts = {};
    for (var id in client.replies[message.sequenceNumber]) {
      var result = client.replies[message.sequenceNumber][id];
      counts[result] = (counts[result] || 0) + 1;
    }
    
    // Check if we have f+1 matching replies
// Check if we have f+1 matching replies
for (var result in counts) {
  var f = Math.floor((NUM_SERVERS - 1) / 3);
  if (counts[result] > f) { // f+1 = 2 with f=1
    console.log("Client has f+1 matching replies for seq " + message.sequenceNumber);
    
    // Result is valid
    // Clear pending request if it's still there
    if (model.pendingClientRequest) {
      model.pendingClientRequest = null;
    }
  }
}

  }
};

// Handle server messages
var handleMessage = function(model, server, message) {
  if (server.state === 'stopped')
    return;
    
  switch (message.type) {
    case 'ClientRequest':
      if (message.direction === 'request') {
        console.log("Server " + server.id + " received client request");
        
        // Process client request if this server is the primary
        if (server.state === 'leader' && server.isPrimary) {
          if (!model.pendingClientRequest || !model.pendingClientRequest.processed) {
            model.pendingClientRequest = message.request;
            model.pendingClientRequest.processAfter = message.recvTime + MIN_RPC_LATENCY;
          }
        }
      }
      break;
      
    case 'PrePrepare':
      if (message.direction === 'request') {
        handlePrePrepareRequest(model, server, message);
      }
      break;
      
    case 'Prepare':
      if (message.direction === 'request') {
        handlePrepareRequest(model, server, message);
      }
      break;
      
    case 'Commit':
      if (message.direction === 'request') {
        handleCommitRequest(model, server, message);
      }
      break;
      
    case 'ViewChange':
      if (message.direction === 'request') {
        rules.processViewChange(model, server, message);
      }
      break;
      
    case 'NewView':
      if (message.direction === 'request') {
        handleNewViewRequest(model, server, message);
      }
      break;
  }
};

var handlePrePrepareRequest = function(model, server, message) {
  // Only process if from current primary
  var primaryId = getPrimaryForView(server.view);
  
  console.log("Server " + server.id + " received PrePrepare from S" + message.from + 
              " for view " + message.view + " (current view: " + server.view + ")");
  
  if (message.from === primaryId && message.view === server.view) {
    // Reset view alarm when receiving a valid pre-prepare - critical to prevent unnecessary view changes
    resetViewAlarm(model, server);
    
    console.log("Server " + server.id + " accepted PrePrepare, sending prepare messages");
    
    // Make sure the message has the request attached
    if (!message.request) {
      console.error("Error: PrePrepare message has no request");
      return;
    }
    
    // Call the sendPrepare function
    rules.sendPrepare(model, server, message);
  } else {
    // Log why we're not processing
    if (message.from !== primaryId) {
      console.log("Server " + server.id + " ignoring PrePrepare: Not from primary");
    }
    if (message.view !== server.view) {
      console.log("Server " + server.id + " ignoring PrePrepare: View mismatch");
    }
  }
};

var handlePrepareRequest = function(model, server, message) {
  console.log("Server " + server.id + " received Prepare from S" + message.from + 
              " for seq " + message.sequenceNumber);
  
  // Reset view alarm when receiving valid messages
  if (message.view === server.view) {
    // Reset view alarm timer to prevent unnecessary view changes
    resetViewAlarm(model, server);
    
    // Record prepare message
    if (!server.prepareMessages[message.sequenceNumber]) {
      server.prepareMessages[message.sequenceNumber] = {};
    }
    server.prepareMessages[message.sequenceNumber][message.from] = message.digest;
    
    // Check if we have enough prepares
    rules.checkPrepareQuorum(model, server, message.sequenceNumber, message.digest);
  } else if (message.view > server.view) {
    // If the message is from a higher view, we may be lagging behind
    console.log("Server " + server.id + " received Prepare from higher view " + 
                message.view + ", current view is " + server.view);
                
    // Update to match the newer view
    server.view = message.view;
    server.viewAlarm = makeViewAlarm(model.time, server.id);
    server.state = 'follower';
    server.isPrimary = false;
    
    // Now handle the message in the new view context
    server.prepareMessages[message.sequenceNumber] = {};
    server.prepareMessages[message.sequenceNumber][message.from] = message.digest;
  } else {
    console.log("Server " + server.id + " ignoring Prepare: View mismatch");
  }
};

var handleCommitRequest = function(model, server, message) {
  console.log("Server " + server.id + " received Commit from S" + message.from + 
              " for seq " + message.sequenceNumber);
  
  // Reset view alarm when receiving valid messages
  if (message.view === server.view) {
    // Reset view alarm timer to prevent unnecessary view changes
    resetViewAlarm(model, server);
    
    // Record commit message
    if (!server.commitMessages[message.sequenceNumber]) {
      server.commitMessages[message.sequenceNumber] = {};
    }
    server.commitMessages[message.sequenceNumber][message.from] = message.digest;
    
    // Check if we have enough commits
    rules.checkCommitQuorum(model, server, message.sequenceNumber, message.digest);
  } else if (message.view > server.view) {
    // If the message is from a higher view, update our view
    console.log("Server " + server.id + " received Commit from higher view " + 
                message.view + ", current view is " + server.view);
                
    // Update to match the newer view
    server.view = message.view;
    server.viewAlarm = makeViewAlarm(model.time, server.id);
    server.state = 'follower';
    server.isPrimary = false;
    
    // Now handle the message in the new view context
    server.commitMessages[message.sequenceNumber] = {};
    server.commitMessages[message.sequenceNumber][message.from] = message.digest;
  } else {
    console.log("Server " + server.id + " ignoring Commit: View mismatch");
  }
};

var handleNewViewRequest = function(model, server, message) {
  console.log("Server " + server.id + " received NewView for view " + message.view + 
              " from S" + message.from);
  
  // Make sure the message is from the correct primary for that view
  var primaryForView = getPrimaryForView(message.view);
  if (message.from !== primaryForView) {
    console.log("Server " + server.id + " ignoring NewView: Not from correct primary");
    return;
  }
  
  // Only accept NewView messages for views >= our current view
  if (message.view >= server.view) {
    // Update to the new view
    server.view = message.view;
    server.viewAlarm = makeViewAlarm(model.time, server.id);
    
    // Clear message counters for the new view
    server.prepareMessages = {};
    server.commitMessages = {};
    
    // Update server state
    server.state = 'follower';
    server.isPrimary = false;
    
    // If this replica is the new primary
    if (getPrimaryForView(server.view) === server.id) {
      server.state = 'leader';
      server.isPrimary = true;
    }
    
    // Reset backoff when successfully adopting a new view
    viewChangeBackoff[server.id] = 1;
  } else {
    console.log("Server " + server.id + " ignoring NewView: view " + message.view + 
                " not higher than current view " + server.view);
  }
};

// Utility functions for PBFT
pbft.stop = function(model, server) {
  console.log("Stopping server " + server.id);
  server.state = 'stopped';
  server.viewAlarm = 0;
};

pbft.resume = function(model, server) {
  console.log("Resuming server " + server.id);
  
  // Find the highest view among active servers
  var maxView = 0;
  var existingPrimaries = [];
  
  model.servers.forEach(function(s) {
    if (s.state !== 'stopped') {
      if (s.view > maxView) {
        maxView = s.view;
      }
      
      if (s.isPrimary) {
        existingPrimaries.push(s);
      }
    }
  });
  
  // Update this server's view to match the system's highest view
  server.view = maxView;
  server.state = 'follower';
  server.isPrimary = false;
  server.viewAlarm = makeViewAlarm(model.time, server.id);
  
  // Determine the correct primary for the highest view
  var correctPrimaryId = getPrimaryForView(maxView);
  
  // If this server should be the primary according to the rotation rule
  // AND no other server is already claiming to be primary
  if (correctPrimaryId === server.id && existingPrimaries.length === 0) {
    console.log("Server " + server.id + " becoming primary for view " + maxView);
    server.state = 'leader';
    server.isPrimary = true;
    
    // Broadcast NewView to confirm leadership
    server.peers.forEach(function(peer) {
      if (model.servers.find(function(s) { return s.id === peer && s.state !== 'stopped'; })) {
        sendRequest(model, {
          from: server.id,
          to: peer,
          type: 'NewView',
          view: maxView,
          term: server.term
        });
      }
    });
  }
  
  // Clear stale message counters
  server.prepareMessages = {};
  server.commitMessages = {};
};

pbft.resumeAll = function(model) {
  console.log("Resuming all servers");
  model.servers.forEach(function(server) {
    pbft.resume(model, server);
  });
  
  // Force all servers to same view
  var maxView = 0;
  model.servers.forEach(function(server) {
    maxView = Math.max(maxView, server.view);
  });
  
  model.servers.forEach(function(server) {
    server.view = maxView;
    if (getPrimaryForView(server.view) === server.id) {
      server.state = 'leader';
      server.isPrimary = true;
    } else {
      server.state = 'follower';
      server.isPrimary = false;
    }
  });
  
  // Generate a client request to demonstrate the protocol
  lastAutoRequestTime = model.time;
  
  // Create client request
  pbft.clientRequest(model);
  
  // Ensure client request is definitely processed AFTER it visibly reaches the primary
  if (model.pendingClientRequest) {
    // Make sure the request takes longer to process than to travel
    // This ensures you see the request message before any pre-prepare messages
    model.pendingClientRequest.processAfter = model.time + MIN_RPC_LATENCY * 5;
  }
};

pbft.restart = function(model, server) {
  console.log("Restarting server " + server.id);
  
  // First stop the server
  pbft.stop(model, server);
  
  // Find the highest view among active servers
  var maxView = 0;
  var existingPrimary = null;
  
  model.servers.forEach(function(s) {
    if (s.state !== 'stopped') {
      if (s.view > maxView) {
        maxView = s.view;
      }
      
      // Track existing primary
      if (s.isPrimary) {
        existingPrimary = s;
      }
    }
  });
  
  // Update this server's view to match the system
  server.view = maxView;
  
  // ALWAYS start as a follower when restarting
  server.state = 'follower';
  server.isPrimary = false;
  server.viewAlarm = makeViewAlarm(model.time, server.id);
  
  // Clear stale message counters
  server.prepareMessages = {};
  server.commitMessages = {};
  
  // Reset view change backoff
  viewChangeBackoff[server.id] = 1;
  
  console.log("Server " + server.id + " restarted as follower in view " + server.view);
};

pbft.drop = function(model, message) {
  console.log("Dropping message from S" + message.from + " to S" + message.to);
  model.messages = model.messages.filter(function(m) {
    return m !== message;
  });
};

pbft.forceViewChange = function(model) {
  console.log("Forcing view change");
  model.servers.forEach(function(server) {
    if (server.state !== 'stopped') {
      server.forceViewChange = true;
      server.viewAlarm = 0; // Force timeout immediately
    }
  });
  
  // Reset auto-request timer after view change
  lastAutoRequestTime = model.time;
};

pbft.clientRequest = function(model) {
  if (!model.client) return;
  
  // Find the actual current primary
  var currentPrimaryId = null;
  var highestView = 0;
  
  model.servers.forEach(function(server) {
    if (server.state !== 'stopped') {
      if (server.isPrimary && server.view >= highestView) {
        highestView = server.view;
        currentPrimaryId = server.id;
      }
      if (server.view > highestView) {
        highestView = server.view;
      }
    }
  });
  
  // If no primary found, use the rotation rule
  if (currentPrimaryId === null) {
    currentPrimaryId = getPrimaryForView(highestView);
  }
  
  // Update client's knowledge
  model.client.currentPrimary = currentPrimaryId;
  model.client.view = highestView;
  
  model.client.requestNumber++;
  
  console.log("Client sending request #" + model.client.requestNumber + 
              " to primary S" + currentPrimaryId + " (view " + highestView + ")");
  
  var request = {
    timestamp: model.time,
    client: model.client.id,
    operation: 'op_' + model.client.requestNumber,
    primary: currentPrimaryId
  };
  
  // Create a visible client request message with FASTER travel time
  var clientMsg = {
    from: CLIENT_NODE_ID,
    to: currentPrimaryId,
    type: 'ClientRequest',
    view: highestView,
    term: 1,
    request: request,
    direction: 'request',
    sendTime: model.time,
    // FASTER travel time - reduced from 3x to 1.5x
    recvTime: model.time + MIN_RPC_LATENCY * 1.5
  };
  
  model.messages.push(clientMsg);
  model.pendingClientRequest = request;
  
  // FASTER processing delay - reduced from 4x to 2x
  model.pendingClientRequest.processAfter = model.time + MIN_RPC_LATENCY * 2;
  
  return request;
};

})();