/* jshint esversion: 9, node: true */
"use strict";

// Ignore change in error caused by SP change.
class RateErrorIgnoresSPChange {
    constructor (options = {}) {
    }

    rateError (value, pid, frame, lastFrame, dT) {
        const rateSP = (frame.sP - lastFrame.sP) / dT;

        return value - rateSP;
    }
}

exports.RateErrorIgnoresSPChange = RateErrorIgnoresSPChange;
