/* jshint esversion: 9, node: true */
"use strict";

class DecayingIntegral {
    static DEFAULT_DECAY_RATE = 0.95;
    static DEFAULT_THRESHOLD  = 20;

    constructor (options = {}) {
        this.decay_rate = options.decay_rate ?? this.constructor.DEFAULT_DECAY_RATE;
        this.threshold  = options.threshold ?? this.constructor.DEFAULT_THRESHOLD;
    }

    sumError (value, pid, frame, lastFrame, dT) {
        let lastSumError = lastFrame.sumError;
        if (Math.abs(lastSumError) >= Math.abs(frame.error * this.threshold)) {
            lastSumError = lastSumError * (this.decay_rate ** dT);
            frame.decayingIntegralActive = true;
        } else {
            frame.decayingIntegralActive = false;
        }
        return lastSumError + (frame.error * dT);
    }
}

exports.DecayingIntegral = DecayingIntegral;
