/* jshint esversion: 9, node: true */
"use strict";

// TODO: make generic 'smoothing' and take which values to operate on as args?
class SmoothedRateError {
    static DEFAULT_SMOOTH_FACTOR = 0.5;

    constructor (options = {}) {
        this.smoothFactor = options.smoothFactor ?? this.constructor.DEFAULT_SMOOTH_FACTOR;
        this.smoothFactor = Math.max(Math.min(this.smoothFactor, 1.0), 0.0);
    }

    rateError (value, pid, frame, lastFrame, dT) {
        frame.preSmoothRateError = value;
        if (lastFrame) {
            return value * (1.0 - this.smoothFactor) + lastFrame.rateError * this.smoothFactor;
        } else {
            return value;
        }
    }
}

exports.SmoothedRateError = SmoothedRateError;
