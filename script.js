/* jshint globalstrict: true */
/* jshint browser: true */
/* jshint devel: true */
/* jshint jquery: true */
/* global util */
/* global raft */
/* global pbft */
/* global makeState */
/* global ELECTION_TIMEOUT */
/* global VIEW_CHANGE_TIMEOUT */
/* global NUM_SERVERS */
/* global CLIENT_NODE_ID */
'use strict';

var playback;
var render = {};
var state;
var record;
var replay;
var usePBFT = true; // Set to true to use PBFT instead of Raft

$(function() {

var ARC_WIDTH = 5;

var onReplayDone = undefined;
record = function(name) {
  localStorage.setItem(name, state.exportToString());
};
replay = function(name, done) {
  state.importFromString(localStorage.getItem(name));
  render.update();
  onReplayDone = done;
};

state = makeState({
  servers: [],
  messages: [],
});

var sliding = false;

var termColors = [
  '#66c2a5',
  '#fc8d62',
  '#8da0cb',
  '#e78ac3',
  '#a6d854',
  '#ffd92f',
];

var SVG = function(tag) {
   return $(document.createElementNS('http://www.w3.org/2000/svg', tag));
};

playback = function() {
  var paused = false;
  var pause = function() {
    paused = true;
    $('#time-icon')
      .removeClass('glyphicon-time')
      .addClass('glyphicon-pause');
    $('#pause').attr('class', 'paused');
    render.update();
  };
  var resume = function() {
    if (paused) {
      paused = false;
      $('#time-icon')
        .removeClass('glyphicon-pause')
        .addClass('glyphicon-time');
      $('#pause').attr('class', 'resumed');
      render.update();
    }
  };
  return {
    pause: pause,
    resume: resume,
    toggle: function() {
      if (paused)
        resume();
      else
        pause();
    },
    isPaused: function() {
      return paused;
    },
  };
}();

(function() {
  for (var i = 1; i <= NUM_SERVERS; i += 1) {
      var peers = [];
      for (var j = 1; j <= NUM_SERVERS; j += 1) {
        if (i != j)
          peers.push(j);
      }
      if (usePBFT) {
        state.current.servers.push(pbft.server(i, peers));
      } else {
        state.current.servers.push(raft.server(i, peers));
      }
  }
})();

var svg = $('svg');

var ringSpec = {
  cx: 210,
  cy: 210,
  r: 150,
};
$('#pause').attr('transform',
  'translate(' + ringSpec.cx + ', ' + ringSpec.cy + ') ' +
  'scale(' + ringSpec.r / 3.5 + ')');

var logsSpec = {
  x: 430,
  y: 50,
  width: 320,
  height: 270,
};

// Add client node for PBFT
if (usePBFT) {
  // Position the client at the bottom center, away from all server nodes
  var clientCoord = {
    x: ringSpec.cx,
    y: ringSpec.cy + ringSpec.r * 1.5  // Position below the ring of servers
  };
  
  $('#servers', svg).append(
    SVG('g')
      .attr('id', 'client-' + CLIENT_NODE_ID)
      .attr('class', 'client')
      .append(SVG('text')
                .attr('class', 'clientid')
                .text('Client')
                .attr({
                  x: clientCoord.x,
                  y: clientCoord.y - 25
                }))
      .append(SVG('rect')
                .attr('class', 'background')
                .attr({
                  x: clientCoord.x - 30,
                  y: clientCoord.y - 15,
                  width: 60,
                  height: 30,
                  rx: 5,
                  ry: 5
                }))
  );
}

var serverSpec = function(id) {
  var coord = util.circleCoord((id - 1) / NUM_SERVERS,
                               ringSpec.cx, ringSpec.cy, ringSpec.r);
  return {
    cx: coord.x,
    cy: coord.y,
    r: 30,
  };
};

$('#ring', svg).attr(ringSpec);

var serverModal;
var messageModal;

state.current.servers.forEach(function (server) {
  var s = serverSpec(server.id);
  $('#servers', svg).append(
    SVG('g')
      .attr('id', 'server-' + server.id)
      .attr('class', 'server')
      .append(SVG('text')
                 .attr('class', 'serverid')
                 .text('S' + server.id)
                 .attr(util.circleCoord((server.id - 1) / NUM_SERVERS,
                                        ringSpec.cx, ringSpec.cy, ringSpec.r + 50)))
      .append(SVG('a')
        .append(SVG('circle')
                   .attr('class', 'background')
                   .attr(s))
        .append(SVG('g')
                    .attr('class', 'votes'))
        .append(SVG('path')
                   .attr('style', 'stroke-width: ' + ARC_WIDTH))
        .append(SVG('text')
                   .attr('class', 'term')
                   .attr({x: s.cx, y: s.cy}))
        ));
});

var MESSAGE_RADIUS = 8;

var messageSpec = function(from, to, frac) {
  var fromSpec, toSpec;
  
  // Handle client node
  if (from === CLIENT_NODE_ID) {
    fromSpec = {
      cx: clientCoord.x,
      cy: clientCoord.y,
      r: 30
    };
  } else {
    fromSpec = serverSpec(from);
  }
  
  if (to === CLIENT_NODE_ID) {
    toSpec = {
      cx: clientCoord.x,
      cy: clientCoord.y,
      r: 30
    };
  } else {
    toSpec = serverSpec(to);
  }
  
  // adjust frac so you start and end at the edge of servers
  var totalDist  = Math.sqrt(Math.pow(toSpec.cx - fromSpec.cx, 2) +
                           Math.pow(toSpec.cy - fromSpec.cy, 2));
  var travel = totalDist - fromSpec.r - toSpec.r;
  frac = (fromSpec.r / totalDist) + frac * (travel / totalDist);
  return {
    cx: fromSpec.cx + (toSpec.cx - fromSpec.cx) * frac,
    cy: fromSpec.cy + (toSpec.cy - fromSpec.cy) * frac,
    r: MESSAGE_RADIUS,
  };
};

var messageArrowSpec = function(from, to, frac) {
  var fromSpec, toSpec;
  
  // Handle client node
  if (from === CLIENT_NODE_ID) {
    fromSpec = {
      cx: clientCoord.x,
      cy: clientCoord.y,
      r: 30
    };
  } else {
    fromSpec = serverSpec(from);
  }
  
  if (to === CLIENT_NODE_ID) {
    toSpec = {
      cx: clientCoord.x,
      cy: clientCoord.y,
      r: 30
    };
  } else {
    toSpec = serverSpec(to);
  }
  
  // adjust frac so you start and end at the edge of servers
  var totalDist = Math.sqrt(Math.pow(toSpec.cx - fromSpec.cx, 2) +
                           Math.pow(toSpec.cy - fromSpec.cy, 2));
  var travel = totalDist - fromSpec.r - toSpec.r;
  var fracS = ((fromSpec.r + MESSAGE_RADIUS)/ totalDist) +
               frac * (travel / totalDist);
  var fracH = ((fromSpec.r + 2*MESSAGE_RADIUS)/ totalDist) +
               frac * (travel / totalDist);
  return [
    'M', fromSpec.cx + (toSpec.cx - fromSpec.cx) * fracS, comma,
         fromSpec.cy + (toSpec.cy - fromSpec.cy) * fracS,
    'L', fromSpec.cx + (toSpec.cx - fromSpec.cx) * fracH, comma,
         fromSpec.cy + (toSpec.cy - fromSpec.cy) * fracH,
  ].join(' ');
};

var comma = ',';
var arcSpec = function(spec, fraction) {
  var radius = spec.r + ARC_WIDTH/2;
  var end = util.circleCoord(fraction, spec.cx, spec.cy, radius);
  var s = ['M', spec.cx, comma, spec.cy - radius];
  if (fraction > 0.5) {
    s.push('A', radius, comma, radius, '0 0,1', spec.cx, spec.cy + radius);
    s.push('M', spec.cx, comma, spec.cy + radius);
  }
  s.push('A', radius, comma, radius, '0 0,1', end.x, end.y);
  return s.join(' ');
};

var timeSlider;

render.clock = function() {
  if (!sliding) {
    timeSlider.slider('setAttribute', 'max', state.getMaxTime());
    timeSlider.slider('setValue', state.current.time, false);
  }
};

var serverActions = [
  ['stop', usePBFT ? pbft.stop : raft.stop],
  ['resume', usePBFT ? pbft.resume : raft.resume],
  ['restart', usePBFT ? pbft.restart : raft.restart],
  ['time out', usePBFT ? function(model, server) { server.viewAlarm = 0; } : raft.timeout],
  ['request', usePBFT ? pbft.clientRequest : raft.clientRequest],
];

var messageActions = [
  ['drop', usePBFT ? pbft.drop : raft.drop],
];

// Define PBFT message types
var MESSAGE_TYPES = {
  'RequestVote': { color: '#66c2a5' },
  'AppendEntries': { color: '#fc8d62' },
  'PrePrepare': { color: '#8da0cb' },
  'Prepare': { color: '#e78ac3' },
  'Commit': { color: '#a6d854' },
  'ViewChange': { color: '#ffd92f' },
  'NewView': { color: '#bebada' },
  'Reply': { color: '#fb8072' }
};

render.servers = function(serversSame) {
  state.current.servers.forEach(function(server) {
    var serverNode = $('#server-' + server.id, svg);
    
    if (usePBFT) {
      // Visualize view timeout instead of election timeout
      $('path', serverNode)
        .attr('d', arcSpec(serverSpec(server.id),
           util.clamp((server.viewAlarm - state.current.time) /
                      (VIEW_CHANGE_TIMEOUT * 2),
                      0, 1)));
    } else {
      // Original Raft visualization
      $('path', serverNode)
        .attr('d', arcSpec(serverSpec(server.id),
           util.clamp((server.electionAlarm - state.current.time) /
                      (ELECTION_TIMEOUT * 2),
                      0, 1)));
    }
    
    if (!serversSame) {
      if (usePBFT) {
        $('text.term', serverNode).text("V" + server.view);
      } else {
        $('text.term', serverNode).text(server.term);
      }
      
      serverNode.attr('class', 'server ' + server.state);
      // In script.js, modify the server rendering:
      $('circle.background', serverNode)
  .attr('style', 'fill: ' +
        (server.state == 'stopped' ? 'gray'
          : usePBFT ? (server.isPrimary ? 'red' : '#66c2a5') // Always use turquoise for backups
          : termColors[server.term % termColors.length]));
              
      var votesGroup = $('.votes', serverNode);
      votesGroup.empty();
      
      if (!usePBFT && server.state == 'candidate') {
        state.current.servers.forEach(function (peer) {
          var coord = util.circleCoord((peer.id - 1) / NUM_SERVERS,
                                       serverSpec(server.id).cx,
                                       serverSpec(server.id).cy,
                                       serverSpec(server.id).r * 5/8);
          var state;
          if (peer == server || server.voteGranted[peer.id]) {
            state = 'have';
          } else if (peer.votedFor == server.id && peer.term == server.term) {
            state = 'coming';
          } else {
            state = 'no';
          }
          var granted = (peer == server ? true : server.voteGranted[peer.id]);
          votesGroup.append(
            SVG('circle')
              .attr({
                cx: coord.x,
                cy: coord.y,
                r: 5,
              })
              .attr('class', state));
        });
      } else if (usePBFT && server.state == 'leader') {
        // For PBFT, show view change votes when a server is trying to become primary
        if (server.viewChangeVotes) {
          state.current.servers.forEach(function(peer) {
            var coord = util.circleCoord((peer.id - 1) / NUM_SERVERS,
                                       serverSpec(server.id).cx,
                                       serverSpec(server.id).cy,
                                       serverSpec(server.id).r * 5/8);
            var voteState = server.viewChangeVotes[peer.id] ? 'have' : 'no';
            votesGroup.append(
              SVG('circle')
                .attr({
                  cx: coord.x,
                  cy: coord.y,
                  r: 5,
                })
                .attr('class', voteState));
          });
        }
      }
      
      serverNode
        .unbind('click')
        .click(function() {
          serverModal(state.current, server);
          return false;
        });
      if (serverNode.data('context'))
        serverNode.data('context').destroy();
      serverNode.contextmenu({
        target: '#context-menu',
        before: function(e) {
          var closemenu = this.closemenu.bind(this);
          var list = $('ul', this.getMenu());
          list.empty();
          serverActions.forEach(function(action) {
            list.append($('<li></li>')
              .append($('<a href="#"></a>')
                .text(action[0])
                .click(function() {
                  state.fork();
                  action[1](state.current, server);
                  state.save();
                  render.update();
                  closemenu();
                  return false;
                })));
          });
          return true;
        },
      });
    }
  });
};

render.entry = function(spec, entry, committed) {
  var entryClass = 'entry ' + (committed ? 'committed' : 'uncommitted');
  
  // Add PBFT specific entry classes
  if (usePBFT && entry.phase) {
    entryClass += ' ' + entry.phase;
  }
  
  return SVG('g')
    .attr('class', entryClass)
    .append(SVG('rect')
      .attr(spec)
      .attr('stroke-dasharray', committed ? '1 0' : '5 5')
      .attr('style', 'fill: ' + termColors[entry.term % termColors.length]))
    .append(SVG('text')
      .attr({x: spec.x + spec.width / 2,
             y: spec.y + spec.height / 2})
      .text(usePBFT ? entry.sequenceNumber : entry.term));
};

render.logs = function() {
  var LABEL_WIDTH = 25;
  var INDEX_HEIGHT = 25;
  var logsGroup = $('.logs', svg);
  logsGroup.empty();
  logsGroup.append(
    SVG('rect')
      .attr('id', 'logsbg')
      .attr(logsSpec));
  var height = (logsSpec.height - INDEX_HEIGHT) / NUM_SERVERS;
  var leader = getLeader();
  var indexSpec = {
    x: logsSpec.x + LABEL_WIDTH + logsSpec.width * 0.05,
    y: logsSpec.y + 2*height/6,
    width: logsSpec.width * 0.9,
    height: 2*height/3,
  };
  var indexes = SVG('g')
    .attr('id', 'log-indexes');
  logsGroup.append(indexes);
  for (var index = 1; index <= 10; ++index) {
    var indexEntrySpec = {
      x: indexSpec.x + (index - 0.5) * indexSpec.width / 11,
      y: indexSpec.y,
      width: indexSpec.width / 11,
      height: indexSpec.height,
    };
    indexes
        .append(SVG('text')
          .attr(indexEntrySpec)
          .text(index));
  }
  
  // Show server logs
  state.current.servers.forEach(function(server) {
    var logSpec = {
      x: logsSpec.x + LABEL_WIDTH + logsSpec.width * 0.05,
      y: logsSpec.y + INDEX_HEIGHT + height * server.id - 5*height/6,
      width: logsSpec.width * 0.9,
      height: 2*height/3,
    };
    var logEntrySpec = function(index) {
      return {
        x: logSpec.x + (index - 1) * logSpec.width / 11,
        y: logSpec.y,
        width: logSpec.width / 11,
        height: logSpec.height,
      };
    };
    var log = SVG('g')
      .attr('id', 'log-S' + server.id);
    logsGroup.append(log);
    log.append(
        SVG('text')
          .text('S' + server.id)
          .attr('class', 'serverid ' + server.state + 
                  (usePBFT && server.isPrimary ? ' leader' : ''))
          .attr({x: logSpec.x - LABEL_WIDTH*4/5,
                 y: logSpec.y + logSpec.height / 2}));
    for (var index = 1; index <= 10; ++index) {
      log.append(SVG('rect')
          .attr(logEntrySpec(index))
          .attr('class', 'log'));
    }
    server.log.forEach(function(entry, i) {
      var index = i + 1;
      if (usePBFT) {
        log.append(render.entry(
          logEntrySpec(index),
          entry,
          index <= server.commitIndex));
      } else {
        log.append(render.entry(
          logEntrySpec(index),
          entry,
          index <= server.commitIndex));
      }
    });
    
    // Show nextIndex and matchIndex for Raft
    if (!usePBFT && leader !== null && leader != server) {
      log.append(
        SVG('circle')
          .attr('title', 'match index')//.tooltip({container: 'body'})
          .attr({cx: logEntrySpec(leader.matchIndex[server.id] + 1).x,
                 cy: logSpec.y + logSpec.height,
                 r: 5}));
      var x = logEntrySpec(leader.nextIndex[server.id] + 0.5).x;
      log.append(SVG('path')
        .attr('title', 'next index')//.tooltip({container: 'body'})
        .attr('style', 'marker-end:url(#TriangleOutM); stroke: black')
        .attr('d', ['M', x, comma, logSpec.y + logSpec.height + logSpec.height/3,
                    'L', x, comma, logSpec.y + logSpec.height + logSpec.height/6].join(' '))
        .attr('stroke-width', 3));
    }
    
    // Show prepare messages and commit messages for PBFT
    if (usePBFT) {
      // Show prepare quorums
      for (var seqNum in server.prepareMessages) {
        if (server.prepareMessages.hasOwnProperty(seqNum)) {
          var count = 0;
          for (var id in server.prepareMessages[seqNum]) {
            count++;
          }
          if (count > 0) {
            var entryIndex = parseInt(seqNum);
            if (entryIndex <= 10) { // Only show first 10 entries
              log.append(
                SVG('text')
                  .attr({
                    x: logEntrySpec(entryIndex).x + logEntrySpec(entryIndex).width / 2,
                    y: logSpec.y + logSpec.height + 15
                  })
                  .text('P:' + count)
                  .attr('style', 'font-size: 10px'));
            }
          }
        }
      }
      
      // Show commit quorums
      for (var seqNum in server.commitMessages) {
        if (server.commitMessages.hasOwnProperty(seqNum)) {
          var count = 0;
          for (var id in server.commitMessages[seqNum]) {
            count++;
          }
          if (count > 0) {
            var entryIndex = parseInt(seqNum);
            if (entryIndex <= 10) { // Only show first 10 entries
              log.append(
                SVG('text')
                  .attr({
                    x: logEntrySpec(entryIndex).x + logEntrySpec(entryIndex).width / 2,
                    y: logSpec.y + logSpec.height + 30
                  })
                  .text('C:' + count)
                  .attr('style', 'font-size: 10px'));
            }
          }
        }
      }
    }
  });
  
  // Show client log in PBFT
  if (usePBFT && state.current.client) {
    var clientSpec = {
      x: logsSpec.x + LABEL_WIDTH + logsSpec.width * 0.05,
      y: logsSpec.y + INDEX_HEIGHT + height * (NUM_SERVERS + 1) - 5*height/6,
      width: logsSpec.width * 0.9,
      height: 2*height/3,
    };
    
    var client = SVG('g')
      .attr('id', 'client-log');
    logsGroup.append(client);
    
    client.append(
        SVG('text')
          .text('Client')
          .attr('class', 'clientid')
          .attr({x: clientSpec.x - LABEL_WIDTH*4/5,
                 y: clientSpec.y + clientSpec.height / 2}));
                 
    // Show pending request if any
    if (state.current.pendingClientRequest) {
      client.append(SVG('rect')
          .attr({
            x: clientSpec.x,
            y: clientSpec.y,
            width: clientSpec.width / 5,
            height: clientSpec.height
          })
          .attr('style', 'fill: #fc8d62')
          .attr('stroke', 'black')
          .attr('stroke-width', '2'));
          
      client.append(SVG('text')
          .attr({
            x: clientSpec.x + clientSpec.width / 10,
            y: clientSpec.y + clientSpec.height / 2
          })
          .text('REQ'));
    }
    
    // Show received replies
    var replyCount = 0;
    for (var seqNum in state.current.client.replies) {
      replyCount += Object.keys(state.current.client.replies[seqNum]).length;
    }
    
    if (replyCount > 0) {
      client.append(SVG('rect')
          .attr({
            x: clientSpec.x + clientSpec.width / 4,
            y: clientSpec.y,
            width: clientSpec.width / 5,
            height: clientSpec.height
          })
          .attr('style', 'fill: #a6d854')
          .attr('stroke', 'black')
          .attr('stroke-width', '2'));
          
      client.append(SVG('text')
          .attr({
            x: clientSpec.x + clientSpec.width / 4 + clientSpec.width / 10,
            y: clientSpec.y + clientSpec.height / 2
          })
          .text(replyCount));
    }
  }
};

render.messages = function(messagesSame) {
  var messagesGroup = $('#messages', svg);
  if (!messagesSame) {
    messagesGroup.empty();
    state.current.messages.forEach(function(message, i) {
      var a = SVG('a')
          .attr('id', 'message-' + i)
          .attr('class', 'message ' + message.direction + ' ' + message.type)
          .attr('title', message.type + ' ' + message.direction)//.tooltip({container: 'body'})
          .append(SVG('circle'))
          .append(SVG('path').attr('class', 'message-direction'));
      if (message.direction == 'reply')
        a.append(SVG('path').attr('class', 'message-success'));
      messagesGroup.append(a);
    });
    state.current.messages.forEach(function(message, i) {
      var messageNode = $('a#message-' + i, svg);
      messageNode
        .click(function() {
          messageModal(state.current, message);
          return false;
        });
      if (messageNode.data('context'))
        messageNode.data('context').destroy();
      messageNode.contextmenu({
        target: '#context-menu',
        before: function(e) {
          var closemenu = this.closemenu.bind(this);
          var list = $('ul', this.getMenu());
          list.empty();
          messageActions.forEach(function(action) {
            list.append($('<li></li>')
              .append($('<a href="#"></a>')
                .text(action[0])
                .click(function() {
                  state.fork();
                  action[1](state.current, message);
                  state.save();
                  render.update();
                  closemenu();
                  return true;
                })));
          });
          return true;
        },
      });
    });
  }
  state.current.messages.forEach(function(message, i) {
    var s = messageSpec(message.from, message.to,
                      (state.current.time - message.sendTime) /
                      (message.recvTime - message.sendTime));
    $('#message-' + i + ' circle', messagesGroup)
      .attr(s);
    if (message.direction == 'reply') {
      var dlist = [];
      dlist.push('M', s.cx - s.r, comma, s.cy,
               'L', s.cx + s.r, comma, s.cy);
      if ((message.type == 'RequestVote' && message.granted) ||
        (message.type == 'AppendEntries' && message.success) ||
        (message.type == 'Reply')) {  // All PBFT replies are considered successful
       dlist.push('M', s.cx, comma, s.cy - s.r,
                  'L', s.cx, comma, s.cy + s.r);
      }
      $('#message-' + i + ' path.message-success', messagesGroup)
        .attr('d', dlist.join(' '));
    }
    var dir = $('#message-' + i + ' path.message-direction', messagesGroup);
    if (playback.isPaused()) {
      dir.attr('style', 'marker-end:url(#TriangleOutS-' + message.type + ')')
         .attr('d',
           messageArrowSpec(message.from, message.to,
                          (state.current.time - message.sendTime) /
                          (message.recvTime - message.sendTime)));
    } else {
      dir.attr('style', '').attr('d', 'M 0,0'); // clear
    }
  });
};

var relTime = function(time, now) {
  if (time == util.Inf)
    return 'infinity';
  var sign = time > now ? '+' : '';
  return sign + ((time - now) / 1e3).toFixed(3) + 'ms';
};

var button = function(label) {
  return $('<button type="button" class="btn btn-default"></button>')
    .text(label);
};

serverModal = function(model, server) {
  var m = $('#modal-details');
  $('.modal-title', m).text('Server ' + server.id);
  $('.modal-dialog', m).removeClass('modal-sm').addClass('modal-lg');
  var li = function(label, value) {
    return '<dt>' + label + '</dt><dd>' + value + '</dd>';
  };
  
  var fields = $('<dl class="dl-horizontal"></dl>')
    .append(li('state', server.state))
    .append(li('term', server.term));
  
  if (usePBFT) {
    // PBFT specific fields
    fields
      .append(li('view', server.view))
      .append(li('isPrimary', server.isPrimary))
      .append(li('sequenceNumber', server.sequenceNumber))
      .append(li('commitIndex', server.commitIndex))
      .append(li('viewAlarm', relTime(server.viewAlarm, model.time)));
  } else {
    // Raft specific fields
    fields
      .append(li('votedFor', server.votedFor))
      .append(li('commitIndex', server.commitIndex))
      .append(li('electionAlarm', relTime(server.electionAlarm, model.time)));
  }
  
  $('.modal-body', m).empty().append(fields);
  
  // Add peer table
  var peerTable = $('<table></table>').addClass('table table-condensed');
  
  if (usePBFT) {
    // PBFT peer table
    peerTable.append($('<tr></tr>')
      .append('<th>peer</th>')
      .append('<th>view change vote</th>')
      .append('<th>prepare msgs</th>')
      .append('<th>commit msgs</th>'));
      
    server.peers.forEach(function(peer) {
      var prepareCount = 0;
      var commitCount = 0;
      
      // Count prepare and commit messages
      for (var seqNum in server.prepareMessages) {
        if (server.prepareMessages[seqNum][peer]) prepareCount++;
      }
      
      for (var seqNum in server.commitMessages) {
        if (server.commitMessages[seqNum][peer]) commitCount++;
      }
      
      peerTable.append($('<tr></tr>')
        .append('<td>S' + peer + '</td>')
        .append('<td>' + (server.viewChangeVotes ? server.viewChangeVotes[peer] : 'N/A') + '</td>')
        .append('<td>' + prepareCount + '</td>')
        .append('<td>' + commitCount + '</td>'));
    });
    
  } else {
    // Raft peer table
    peerTable.append($('<tr></tr>')
      .append('<th>peer</th>')
      .append('<th>next index</th>')
      .append('<th>match index</th>')
      .append('<th>vote granted</th>')
      .append('<th>RPC due</th>')
      .append('<th>heartbeat due</th>'));
      
    server.peers.forEach(function(peer) {
      peerTable.append($('<tr></tr>')
        .append('<td>S' + peer + '</td>')
        .append('<td>' + server.nextIndex[peer] + '</td>')
        .append('<td>' + server.matchIndex[peer] + '</td>')
        .append('<td>' + server.voteGranted[peer] + '</td>')
        .append('<td>' + relTime(server.rpcDue[peer], model.time) + '</td>')
        .append('<td>' + relTime(server.heartbeatDue[peer], model.time) + '</td>'));
    });
  }
  
  $('.modal-body', m).append($('<dt>peers</dt>')).append($('<dd></dd>').append(peerTable));
  
  // Add log entries
  if (server.log.length > 0) {
    var logTable = $('<table></table>').addClass('table table-condensed');
    
    if (usePBFT) {
      logTable.append($('<tr></tr>')
        .append('<th>seq#</th>')
        .append('<th>term</th>')
        .append('<th>phase</th>'));
        
      server.log.forEach(function(entry) {
        logTable.append($('<tr></tr>')
          .append('<td>' + entry.sequenceNumber + '</td>')
          .append('<td>' + entry.term + '</td>')
          .append('<td>' + entry.phase + '</td>'));
      });
    } else {
      logTable.append($('<tr></tr>')
        .append('<th>index</th>')
        .append('<th>term</th>')
        .append('<th>value</th>'));
        
      server.log.forEach(function(entry, i) {
        logTable.append($('<tr></tr>')
          .append('<td>' + (i+1) + '</td>')
          .append('<td>' + entry.term + '</td>')
          .append('<td>' + entry.value + '</td>'));
      });
    }
    
    $('.modal-body', m).append($('<dt>log</dt>')).append($('<dd></dd>').append(logTable));
  }
  
  var footer = $('.modal-footer', m);
  footer.empty();
  serverActions.forEach(function(action) {
    footer.append(button(action[0])
      .click(function(){
        state.fork();
        action[1](model, server);
        state.save();
        render.update();
        m.modal('hide');
      }));
  });
  m.modal();
};

messageModal = function(model, message) {
  var m = $('#modal-details');
  $('.modal-dialog', m).removeClass('modal-lg').addClass('modal-sm');
  $('.modal-title', m).text(message.type + ' ' + message.direction);
  var li = function(label, value) {
    return '<dt>' + label + '</dt><dd>' + value + '</dd>';
  };
  var fields = $('<dl class="dl-horizontal"></dl>')
      .append(li('from', 'S' + message.from))
      .append(li('to', 'S' + message.to))
      .append(li('sent', relTime(message.sendTime, model.time)))
      .append(li('deliver', relTime(message.recvTime, model.time)))
      .append(li('term', message.term));
      
  if (usePBFT) {
    // PBFT specific fields
    if (message.view !== undefined) {
      fields.append(li('view', message.view));
    }
    
    if (message.type === 'PrePrepare' || message.type === 'Prepare' || 
        message.type === 'Commit' || message.type === 'Reply') {
      fields.append(li('sequence', message.sequenceNumber));
    }
    
    if (message.digest !== undefined) {
      fields.append(li('digest', message.digest));
    }
    
    if (message.type === 'Reply') {
      fields.append(li('result', message.result));
    }
    
    if (message.type === 'ViewChange') {
      fields.append(li('newView', message.newView));
      fields.append(li('lastSequence', message.lastSequence));
    }
  } else {
    // Raft specific fields
    if (message.type == 'RequestVote') {
      if (message.direction == 'request') {
        fields.append(li('lastLogIndex', message.lastLogIndex));
        fields.append(li('lastLogTerm', message.lastLogTerm));
      } else {
        fields.append(li('granted', message.granted));
      }
    } else if (message.type == 'AppendEntries') {
      if (message.direction == 'request') {
        var entries = '[' + message.entries.map(function(e) {
              return e.term;
        }).join(' ') + ']';
        fields.append(li('prevIndex', message.prevIndex));
        fields.append(li('prevTerm', message.prevTerm));
        fields.append(li('entries', entries));
        fields.append(li('commitIndex', message.commitIndex));
      } else {
        fields.append(li('success', message.success));
        fields.append(li('matchIndex', message.matchIndex));
      }
    }
  }
  
  $('.modal-body', m)
    .empty()
    .append(fields);
  var footer = $('.modal-footer', m);
  footer.empty();
  messageActions.forEach(function(action) {
    footer.append(button(action[0])
      .click(function(){
        state.fork();
        action[1](state.current, message);
        state.save();
        render.update();
        m.modal('hide');
      }));
  });
  m.modal();
};

// Setup PBFT scenario
// Setup PBFT scenario
var setupPBFTScenario = function(model) {
  // Clear any existing state
  model.messages = [];
  model.pendingClientRequest = null;
  
  // Initialize servers
  for (var i = 0; i < model.servers.length; i++) {
    pbft.restart(model, model.servers[i]);
  }
  
  // Set up view 1 with server 1 as primary
  model.servers.forEach(function(server) {
    server.view = 1;
    server.term = 1;
    server.log = [];  // Clear log
    server.prepareMessages = {};  // Clear prepare messages
    server.commitMessages = {};  // Clear commit messages
    server.sequenceNumber = 0;  // Reset sequence number
    
    if (server.id === 1) {
      server.state = 'leader';
      server.isPrimary = true;
    } else {
      server.state = 'follower';
      server.isPrimary = false;
    }
    
    // Reset view alarm with a longer initial timeout to avoid immediate view changes
    server.viewAlarm = model.time + VIEW_CHANGE_TIMEOUT * 2;
  });
  
  // Create client
  var serverIds = model.servers.map(function(server) { return server.id; });
  model.client = pbft.client(CLIENT_NODE_ID, serverIds);
  model.client.currentPrimary = 1;  // Set the initial primary explicitly
  model.client.view = 1;  // Set initial view
  
  // Schedule client request with a delay to allow visualization setup
  setTimeout(function() {
    state.fork();
    var request = pbft.clientRequest(state.current);
    
    // Override with extremely long processing delay to ensure visibility
    state.current.pendingClientRequest.processAfter = state.current.time + MIN_RPC_LATENCY * 2;
    
    state.save();
    render.update();
  }, 1000);
  
  console.log("PBFT scenario setup complete");
};

// Transforms the simulation speed from a linear slider
// to a logarithmically scaling time factor.
var speedSliderTransform = function(v) {
  v = Math.pow(10, v);
  if (v < 1)
    return 1;
  else
    return v;
};

var lastRenderedO = null;
var lastRenderedV = null;
render.update = function() {
  // Same indicates both underlying object identity hasn't changed and its
  // value hasn't changed.
  var serversSame = false;
  var messagesSame = false;
  if (lastRenderedO == state.current) {
    serversSame = util.equals(lastRenderedV.servers, state.current.servers);
    messagesSame = util.equals(lastRenderedV.messages, state.current.messages);
  }
  lastRenderedO = state;
  lastRenderedV = state.base();
  render.clock();
  render.servers(serversSame);
  render.messages(messagesSame);
  if (!serversSame)
    render.logs();
};

(function() {
  var last = null;
  var step = function(timestamp) {
    if (!playback.isPaused() && last !== null && timestamp - last < 500) {
      var wallMicrosElapsed = (timestamp - last) * 1000;
      var speed = speedSliderTransform($('#speed').slider('getValue'));
      var modelMicrosElapsed = wallMicrosElapsed / speed;
      var modelMicros = state.current.time + modelMicrosElapsed;
      state.seek(modelMicros);
      if (modelMicros >= state.getMaxTime() && onReplayDone !== undefined) {
        var f = onReplayDone;
        onReplayDone = undefined;
        f();
      }
      render.update();
    }
    last = timestamp;
    window.requestAnimationFrame(step);
  };
  window.requestAnimationFrame(step);
})();

$(window).keyup(function(e) {
  if (e.target.id == "title")
    return;
  var leader = usePBFT ? null : getLeader();
  if (e.keyCode == ' '.charCodeAt(0) ||
      e.keyCode == 190 /* dot, emitted by Logitech remote */) {
    $('.modal').modal('hide');
    playback.toggle();
  } else if (e.keyCode == 'C'.charCodeAt(0)) {
    if (usePBFT) {
      // For PBFT, send a client request
      state.fork();
      pbft.clientRequest(state.current);
      state.save();
      render.update();
      $('.modal').modal('hide');
    } else if (leader !== null) {
      // For Raft, send request to leader
      state.fork();
      raft.clientRequest(state.current, leader);
      state.save();
      render.update();
      $('.modal').modal('hide');
    }
  } else if (e.keyCode == 'R'.charCodeAt(0)) {
    if (!usePBFT && leader !== null) {
      state.fork();
      raft.stop(state.current, leader);
      raft.resume(state.current, leader);
      state.save();
      render.update();
      $('.modal').modal('hide');
    }
  } else if (e.keyCode == 'T'.charCodeAt(0)) {
    if (!usePBFT) {
      state.fork();
      raft.spreadTimers(state.current);
      state.save();
      render.update();
      $('.modal').modal('hide');
    }
  } else if (e.keyCode == 'A'.charCodeAt(0)) {
    if (!usePBFT) {
      state.fork();
      raft.alignTimers(state.current);
      state.save();
      render.update();
      $('.modal').modal('hide');
    }
  } else if (e.keyCode == 'L'.charCodeAt(0)) {
    if (!usePBFT) {
      state.fork();
      playback.pause();
      raft.setupLogReplicationScenario(state.current);
      state.save();
      render.update();
      $('.modal').modal('hide');
    }
  } else if (e.keyCode == 'B'.charCodeAt(0)) {
    state.fork();
    if (usePBFT) {
      pbft.resumeAll(state.current);
    } else {
      raft.resumeAll(state.current);
    }
    state.save();
    render.update();
    $('.modal').modal('hide');
  } else if (e.keyCode == 'F'.charCodeAt(0)) {
    state.fork();
    render.update();
    $('.modal').modal('hide');
  } else if (e.keyCode == 'P'.charCodeAt(0)) {
    if (usePBFT) {
      state.fork();
      setupPBFTScenario(state.current);
      state.save();
      render.update();
      $('.modal').modal('hide');
    }
  } // Replace the view change code in keyboard handler
  else if (e.keyCode == 'V'.charCodeAt(0)) {
    if (usePBFT) {
      // Force view change for PBFT
      state.fork();
      pbft.forceViewChange(state.current);
      state.save();
      render.update();
      $('.modal').modal('hide');
    }
  }else if (e.keyCode == 191 && e.shiftKey) { /* question mark */
    playback.pause();
    $('#modal-help').modal('show');
  }
});

$('#modal-details').on('show.bs.modal', function(e) {
  playback.pause();
});

var getLeader = function() {
  var leader = null;
  var term = 0;
  state.current.servers.forEach(function(server) {
    if (server.state == 'leader' &&
        server.term > term) {
        leader = server;
        term = server.term;
    }
  });
  return leader;
};

$("#speed").slider({
  tooltip: 'always',
  formater: function(value) {
    return '1/' + speedSliderTransform(value).toFixed(0) + 'x';
  },
  reversed: true,
});

timeSlider = $('#time');
timeSlider.slider({
  tooltip: 'always',
  formater: function(value) {
    return (value / 1e6).toFixed(3) + 's';
  },
});
timeSlider.on('slideStart', function() {
  playback.pause();
  sliding = true;
});
timeSlider.on('slideStop', function() {
  // If you click rather than drag,  there won't be any slide events, so you
  // have to seek and update here too.
  state.seek(timeSlider.slider('getValue'));
  sliding = false;
  render.update();
});
timeSlider.on('slide', function() {
  state.seek(timeSlider.slider('getValue'));
  render.update();
});

$('#time-button')
  .click(function() {
    playback.toggle();
    return false;
  });

// Disabled for now, they don't seem to behave reliably.
// // enable tooltips
// $('[data-toggle="tooltip"]').tooltip();

state.updater = function(state) {
  if (usePBFT) {
    pbft.update(state.current);
  } else {
    raft.update(state.current);
  }
  var time = state.current.time;
  var base = state.base(time);
  state.current.time = base.time;
  var same = util.equals(state.current, base);
  state.current.time = time;
  return !same;
};

state.init();
render.update();
});