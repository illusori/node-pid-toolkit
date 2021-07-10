/* jshint esversion: 9, node: true */
"use strict";

class DecayingIntegral {
    static DEFAULT_DECAY_RATE = 0.95;

    constructor (options = {}) {
        this.decay_rate = options.decay_rate ?? this.constructor.DEFAULT_DECAY_RATE;
    }

    sumError (value, pid, frame, lastFrame, dT) {
        return (lastFrame.sumError * this.decay_rate) + (frame.error * dT);
    }
}

exports.DecayingIntegral = DecayingIntegral;
