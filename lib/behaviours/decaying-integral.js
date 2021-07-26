/* jshint esversion: 9, node: true */
"use strict";

class DecayingIntegral {
    static DEFAULT_DECAY_RATE = 0.95;
    static DEFAULT_THRESHOLD  = 20;

    constructor (options = {}) {
        this.decayRate = options.decayRate ?? this.constructor.DEFAULT_DECAY_RATE;
        this.threshold = options.threshold ?? this.constructor.DEFAULT_THRESHOLD;
    }

    overThreshold (value, pid, frame, lastFrame, dT) {
        let lastSumError = lastFrame.sumError;

        return Math.abs(lastSumError) >= Math.abs(frame.error * this.threshold);
    }

    shouldDecay (value, pid, frame, lastFrame, dT) {
        return lastFrame.windingUp() &&
            this.overThreshold(value, pid, frame, lastFrame, dT);
    }

    sumError (value, pid, frame, lastFrame, dT) {
        let lastSumError = lastFrame.sumError;

        frame.decayingIntegralActive = this.shouldDecay(value, pid, frame, lastFrame, dT);
        if (frame.decayingIntegralActive) {
            lastSumError = lastSumError * (this.decayRate ** dT);
        }
        return lastSumError + (frame.error * dT);
    }
}

exports.DecayingIntegral = DecayingIntegral;
