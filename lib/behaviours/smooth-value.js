/* jshint esversion: 9, node: true */
"use strict";

class SmoothValue {
    static DEFAULT_SMOOTH_FACTOR = 0.5;

    constructor (options = {}) {
        this.smoothFactor = options.smoothFactor ?? this.constructor.DEFAULT_SMOOTH_FACTOR;
        this.smoothFactor = Math.max(Math.min(this.smoothFactor, 1.0), 0.0);
        this.value = options.value;
        this[this.value] = this.smoothValue;
    }

    smoothValue(value, pid, frame, lastFrame, dT) {
        frame['preSmooth' + this.value.slice(0, 1).toUpperCase() + this.value.slice(1)] = value;
        if (lastFrame) {
            return value * (1.0 - this.smoothFactor) + lastFrame[this.value] * this.smoothFactor;
        } else {
            return value;
        }
    }
}

exports.SmoothValue = SmoothValue;
