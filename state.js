/* jshint globalstrict: true */
/* jshint browser: true */
/* jshint devel: true */
/* jshint jquery: true */
/* global util */
/* global pbft */
/* global raft */
'use strict';

var makeState = function(initial) {
  var checkpoints = [];
  var maxTime = 0;
  var timers = [];
  var usePBFT = true; // Flag to determine which protocol to use
  
  var prev = function(time) {
      return util.greatestLower(checkpoints,
                                function(m) { return m.time > time; });
  };
  
  var runTimers = function(time) {
    var fire = [];
    timers = timers.filter(function(timer) {
      if (timer.time <= time) {
        fire.push(timer);
        return false;
      } else {
        return true;
      }
    });
    fire.forEach(function(timer) {
      timer.callback();
    });
  };
  
  var self = {
    current: initial,
    usePBFT: usePBFT, // Expose the PBFT flag
    
    getMaxTime: function() {
      return maxTime;
    },
    
    init: function() {
      checkpoints.push(util.clone(self.current));
    },
    
    fork: function() {
      var i = prev(self.current.time);
      while (checkpoints.length - 1 > i)
        checkpoints.pop();
      maxTime = self.current.time;
      timers = [];
    },
    
    rewind: function(time) {
      self.current = util.clone(checkpoints[prev(time)]);
      self.current.time = time;
      runTimers(time);
    },
    
    base: function() {
      return checkpoints[prev(self.current.time)];
    },
    
    advance: function(time) {
      maxTime = time;
      self.current.time = time;
      if (self.updater(self))
        checkpoints.push(util.clone(self.current));
      runTimers(time);
    },
    
    save: function() {
      checkpoints.push(util.clone(self.current));
    },
    
    seek: function(time) {
      if (time <= maxTime) {
        self.rewind(time);
      } else if (time > maxTime) {
        self.advance(time);
      }
    },
    
    updater: function(state) { 
      if (usePBFT) {
        pbft.update(state.current);
      } else {
        raft.update(state.current);
      }
      var time = state.current.time;
      var base = state.base();
      state.current.time = base.time;
      var same = util.equals(state.current, base);
      state.current.time = time;
      return !same;
    },
    
    exportToString: function() {
      return JSON.stringify({
        checkpoints: checkpoints,
        maxTime: maxTime,
        usePBFT: usePBFT
      });
    },
    
    importFromString: function(s) {
      var o = JSON.parse(s);
      checkpoints = o.checkpoints;
      maxTime = o.maxTime;
      usePBFT = o.usePBFT !== undefined ? o.usePBFT : usePBFT;
      self.current = util.clone(checkpoints[0]);
      self.current.time = 0;
      timers = [];
    },
    
    clear: function() {
      checkpoints = [];
      self.current = initial;
      self.current.time = 0;
      maxTime = 0;
      timers = [];
    },
    
    schedule: function(time, callback) {
      timers.push({time: time, callback: callback});
    },
    
    // Toggle between PBFT and Raft protocols
    toggleProtocol: function() {
      usePBFT = !usePBFT;
      self.clear();
      self.init();
      return usePBFT;
    },
    
    // Set protocol explicitly
    setProtocol: function(isPBFT) {
      if (usePBFT !== isPBFT) {
        usePBFT = isPBFT;
        self.clear();
        self.init();
      }
      return usePBFT;
    },
    
    // Check if using PBFT
    isPBFT: function() {
      return usePBFT;
    }
  };
  
  self.current.time = 0;
  return self;
};