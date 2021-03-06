/* jshint esversion: 9, node: true */
"use strict";

class Basic {
    constructor () {
    }

    error (value, pid, frame, lastFrame, dT) {
        return frame.sP - frame.pV;
    }

    rateError (value, pid, frame, lastFrame, dT) {
        return (frame.error - lastFrame.error) / dT;
    }

    sumError (value, pid, frame, lastFrame, dT) {
        return lastFrame.sumError + frame.error * dT;
    }
}

exports.Basic = Basic;
