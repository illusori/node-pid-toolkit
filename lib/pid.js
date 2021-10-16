/* jshint esversion: 9, node: true */
"use strict";

const performance = window?.performance ?? require('perf_hooks').performance;
const { Basic } = require('./behaviours/basic');

class PID {
    static DEFAULT_KP = 1;
    static DEFAULT_TI = 1;
    static DEFAULT_TD = 1;
    static DEFAULT_SP = 0;

    static DEFAULT_MAX_UPDATE_FRAMES = 5;
    static DEFAULT_MIN_UPDATE_TIME = 0.0000001;

    static DEFAULT_BEHAVIOURS = [new Basic()];

    static BEHAVIOUR_METHODS = [
        'sP',
        'pV',
        'error',
        'rateError',
        'sumError',
    ];

    constructor (options = {}) {
        this.kP = options.kP ?? this.constructor.DEFAULT_KP;
        this.kI = options.kI ?? (this.kP / (options.tI ?? this.constructor.DEFAULT_TI));
        this.kD = options.kD ?? (this.kP / (options.tD ?? this.constructor.DEFAULT_TD));
        this.max_update_frames = options.max_update_frames ?? this.constructor.DEFAULT_MAX_UPDATE_FRAMES;
        this.min_update_time = options.min_update_time ?? this.constructor.DEFAULT_MIN_UPDATE_TIME;
        // Group supplied behaviours by the methods they modify.
        this.behaviours = Object.fromEntries(this.constructor.BEHAVIOUR_METHODS.map(k => [k, []]));
        (options.behaviours ?? this.constructor.DEFAULT_BEHAVIOURS).forEach(behaviour => {
            this.constructor.BEHAVIOUR_METHODS.forEach(method => {
                if (behaviour[method]) {
                    this.behaviours[method].push(behaviour);
                }
            });
        });
        this.reset(options.t ?? null);
    }

    // Error limit of proportional control.
    pLimit () {
        return 1 / this.kP;
    }

    // Upper limit of proportional control
    pMax () {
        return this.sP + this.pLimit();
    }

    // Lower limit of proportional control
    pMin () {
        return this.sP - this.pLimit();
    }

    reset (t = null) {
        this.sP = this.constructor.DEFAULT_SP;
        // TODO: bad assumption to assume pV is correct?
        let frame = new PIDFrame(this.sP, this.sP, t);
        frame.error = 0;
        frame.sumError = 0;
        frame.rateError = 0;
        frame.control = 0;
        this.updateFrames = [frame];
    }

    update (pV, t = null) {
        let frame = new PIDFrame(this.sP, pV, t);
        let lastFrame = this.updateFrames[0];
        let dT = frame.t - lastFrame.t;

        if (dT < this.min_update_time) {
            // Update is too soon after previous.
            // TODO: issue warning
            return lastFrame.control;
        }

        if (this.updateFrame(frame, lastFrame, dT)) {
            this.storeFrame(frame);
        }

        // TODO: abstraction layer?
        return this.updateFrames[0].control;
    }

    updateFrame (frame, lastFrame, dT) {
        frame.sP = this.behaviourReduce('sP', frame.sP, frame, lastFrame, dT);
        frame.pV = this.behaviourReduce('pV', frame.pV, frame, lastFrame, dT);
        frame.error = this.behaviourReduce('error', 0, frame, lastFrame, dT);
        frame.rateError = this.behaviourReduce('rateError', 0, frame, lastFrame, dT);
        frame.sumError = this.behaviourReduce('sumError', 0, frame, lastFrame, dT);

        frame.control = (frame.error * this.kP) + (frame.sumError * this.kI) + (frame.rateError * this.kD);

        return true;
    }

    behaviourReduce (method, value, frame, lastFrame, dT) {
        this.behaviours[method].forEach(behaviour => {
            value = behaviour[method](value, this, frame, lastFrame, dT);
        });
        return value;
    }

    storeFrame (frame) {
        this.updateFrames.unshift(frame);
        if (this.max_update_frames >= 1) {
            while (this.updateFrames.length > this.max_update_frames) {
                this.updateFrames.pop();
            }
        }
    }
}

class PIDFrame {
    constructor (sP, pV, t) {
        this.sP = sP;
        this.pV = pV;
        this.t = t ?? performance.now();
        this.error = null;
        this.sumError = null;
        this.rateError = null;
        this.control = null;
    }

    windingUp () {
        return this.sumError * this.rateError > 0;
    }

    windingDown () {
        return this.sumError * this.rateError < 0;
    }

    errorIncreasing () {
        return this.error * this.rateError < 0;
    }

    errorDecreasing () {
        return this.error * this.rateError > 0;
    }
}

exports.PID = PID;
