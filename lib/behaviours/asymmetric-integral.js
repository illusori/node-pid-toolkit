/* jshint esversion: 9, node: true */
"use strict";

class AsymmetricIntegral {
    static DIVERGING_RATE  = 1;
    static CONVERGING_RATE = 5;

    constructor (options = {}) {
        this.divergingRate  = options.divergingRate  ?? this.constructor.DEFAULT_DIVERGING_RATE;
        this.convergingRate = options.convergingRate ?? this.constructor.DEFAULT_CONVERGING_RATE;
    }

    sumError (value, pid, frame, lastFrame, dT) {
        let lastSumError = lastFrame.sumError;
        let delta = frame.error * dT;
        let originalDelta = delta;

        if (frame.errorIncreasing()) {
            delta *= this.divergingRate;
        } else if (frame.errorDecreasing()) {
            delta *= this.convergingRate;
            if (Math.abs(delta) > Math.abs(lastSumError)) {
                // Ensure we don't overshoot across zero.
//                return 0;
                delta = originalDelta;
            }
        }

        return lastSumError + delta;
    }
}

exports.AsymmetricIntegral = AsymmetricIntegral;
