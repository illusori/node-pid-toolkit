/* jshint esversion: 9, node: true */
"use strict";

// Freezes the integral if the error passes outside the limit of proportional control.
// You probably always want this to be last of any integral behaviours.
class PLimitIntegral {
    constructor (options = {}) {
    }

    sumError (value, pid, frame, lastFrame, dT) {
        const lastSumError = lastFrame.sumError;
        const withinPLimit = Math.abs(pid.pLimit()) >= Math.abs(frame.error);

        if (withinPLimit) {
            return value;
        }

        return lastSumError;
    }
}

exports.PLimitIntegral = PLimitIntegral;
