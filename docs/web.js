(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
/* jshint esversion: 9, node: true */
"use strict";

(function (document, window, undefined) {

const { PID } = require('../lib/pid');
const { Basic } = require('../lib/behaviours/basic');
const { DecayingIntegral } = require('../lib/behaviours/decaying-integral');
const { AsymmetricIntegral } = require('../lib/behaviours/asymmetric-integral');
const { PLimitIntegral } = require('../lib/behaviours/plimit-integral');
const { RateErrorIgnoresSPChange } = require('../lib/behaviours/rate-error-ignores-sp-change');
const { SmoothValue } = require('../lib/behaviours/smooth-value');

class Simulation {
    constructor (options) {
        this.noiseSequence = new Array(1000).fill(0).map(v => (Math.random() + Math.random()) * 0.5);
        this.configure(options);
        this.reset();
    }

    configure (options) {
        this.sP = options.sP;
        this.pV = options.initialPV;
        this.measurementNoise = options.measurementNoise;
        this.control = 0; // target control
        this.restrictedControl = 0; // target control restricted to saturation
        this.actualControl = 0; // actual current control subject to actuation delay
        this.effectiveControl = 0; // actual effective current control
        this.dT = options.dT;
        this.saturation = [options.saturationDown, options.saturationUp];
        this.actuationFactor = options.actuationFactor;
        this.authority = [options.authorityDown, options.authorityUp];
        this.duration = options.duration;
        this.drift = options.drift;

        this.setPoints = this.parseSetPoints(options.setPoints);
        this.nextSetPoint = 0;

        let behaviours = [new Basic()];
        if (options.decayingIntegral) {
            behaviours.push(new DecayingIntegral({
                decayRate: options.decayRate,
                threshold: options.decayThreshold,
            }));
        }
        if (options.asymmetricIntegral) {
            behaviours.push(new AsymmetricIntegral({
                divergingRate: options.divergingRate,
                convergingRate: options.convergingRate,
            }));
        }
        // Should always be last of the integral behaviours.
        if (options.pLimitIntegral) {
            behaviours.push(new PLimitIntegral({
            }));
        }
        if (options.rateErrorIgnoresSPChange) {
            behaviours.push(new RateErrorIgnoresSPChange({
            }));
        }
        if (options.smoothedPV) {
            behaviours.push(new SmoothValue({
                smoothFactor: options.smoothedPVFactor,
                value: 'pV',
            }));
        }
        if (options.smoothedSP) {
            behaviours.push(new SmoothValue({
                smoothFactor: options.smoothedSPFactor,
                value: 'sP',
            }));
        }
        if (options.smoothedRateError) {
            behaviours.push(new SmoothValue({
                smoothFactor: options.smoothedRateErrorFactor,
                value: 'rateError',
            }));
        }
        if (options.smoothedError) {
            behaviours.push(new SmoothValue({
                smoothFactor: options.smoothedErrorFactor,
                value: 'error',
            }));
        }
        if (options.smoothedSumError) {
            behaviours.push(new SmoothValue({
                smoothFactor: options.smoothedSumErrorFactor,
                value: 'sumError',
            }));
        }

        this.pid = new PID({
          t: 0,
          kP: options.kP,
          tI: options.tI,
          tD: options.tD,
          behaviours: behaviours,
        });
    }

    reset () {
        this.noiseOffset = 0;
        this.t = 0;
        this.data = [];
        this.pid.reset(this.t);
        this.pid.sP = this.sP;

        // FIXME: should push an initial data frame.
    }

    parseSetPoints (sequence) {
        return sequence.split(',')
            .map(segment => segment.split('@'))
            .map(([value, when]) => { return { when: Number.parseFloat(when), value: Number.parseFloat(value) } });
    }

    noiseFactor () {
        return this.noiseSequence[this.noiseOffset++ % this.noiseSequence.length];
    }

    noise (n) {
        return (2 * n * this.noiseFactor()) - n;
    }

    measuredPV () {
        return this.pV + this.noise(this.measurementNoise);
    }

    update (dT) {
        this.t += dT;

        // Apply control to "simulation"
        this.pV += this.effectiveControl * dT;

        // Apply drift.
        this.pV += this.drift * dT;

        // Apply changes in set point.
        if ((this.nextSetPoint < this.setPoints.length) && (this.setPoints[this.nextSetPoint].when <= this.t)) {
            this.sP = this.pid.sP = this.setPoints[this.nextSetPoint].value;
            this.nextSetPoint++;
        }

        // Update and display PID.
        this.control = this.pid.update(this.measuredPV(), this.t);

        this.restrictedControl = this.control;
        if (this.restrictedControl < 0) {
            if (this.saturation[0] !== null && this.restrictedControl < this.saturation[0]) {
                this.restrictedControl = this.saturation[0];
            }
            this.actualControl += (this.restrictedControl - this.actualControl) * this.actuationFactor;
            this.effectiveControl = this.actualControl * this.authority[0];
        } else {
            if (this.saturation[1] !== null && this.restrictedControl > this.saturation[1]) {
                this.restrictedControl = this.saturation[1];
            }
            this.actualControl += (this.restrictedControl - this.actualControl) * this.actuationFactor;
            this.effectiveControl = this.actualControl * this.authority[1];
        }

        let frame = this.pid.updateFrames[0];

        this.data.push({
            frame: frame,
            pV: this.pV, // actual pV
            restrictedControl: this.restrictedControl,
            actualControl:     this.actualControl,
            effectiveControl:  this.effectiveControl,
            pMax: this.pid.pMax(),
            pMin: this.pid.pMin(),
        });
    }

    run () {
        for (let i = 0; i < this.duration; i += this.dT) {
            this.update(this.dT);
        }
    }
}

class SimulationTable {
    constructor (options = {}) {
        const table = d3.select(".sim-table").append("table")

        table.append("thead").html(`<tr>
            <th>T</th>
            <th>sP</th>
            <th>pV</th>
            <th>error</th>
            <th>sumError</th>
            <th>rateError</th>
            <th>control</th>
            <th>restrictedControl</th>
            <th>actualControl</th>
            <th>effectiveControl</th>
        </tr>`);

        this.node = table.append("tbody");
    }

    update (simulation) {
        const dataRow = (d) => {
            return `
                <td style="text-align: left;">${d.frame.t}</td>
                <td>${d.frame.sP}</td>
                <td>${d.frame.pV}</td>
                <td>${d.frame.error}</td>
                <td>${d.frame.sumError}</td>
                <td>${d.frame.rateError}</td>
                <td>${d.frame.control}</td>
                <td>${d.restrictedControl}</td>
                <td>${d.actualControl}</td>
                <td>${d.effectiveControl}</td>
            `;
        };

        const tr = this.node.selectAll("tr")
            .data(simulation.data)
            .html(dataRow);

        tr.enter().append('tr')
            .html(dataRow);

        tr.exit().remove();

        // A closure over the current simulation.data acting as a factory for
        // an immediately-invoked bisector, SURE that's the simple way of doing this.
        this.bisect = (t) => d3.bisector(d => d.frame.t).left(simulation.data, t, 1);
    }

    showRuler () {
    }

    hideRuler () {
    }

    updateRuler (t) {
        const i = this.bisect(t);
        const nodes = this.node.selectAll("tr").nodes();
        const targetNode = nodes[i];
        //console.log(`Scrolling to t${t} row ${i} with offset ${targetNode.offsetTop}px`, targetNode);
        nodes.forEach((node, idx) => {
            node.className = idx == i ? 'highlight' : '';
        });
        // SURE this is maintainable.
        this.node.node().parentNode.parentNode.scrollTo(0, targetNode.offsetTop - 100);
    }
}

class SimulationChart {
    constructor (options = {}) {
        this.selector = options.selector;
        this.width = options.width;
        this.height = options.height;
        this.independentScale = options.independentScale;
        this.mouseOver = options.mouseOver;
        this.mouseMove = options.mouseMove;
        this.mouseOut = options.mouseOut;

        const svg = d3.select(this.selector).append("svg")
        svg.attr("width", this.width)
            .attr("height", this.height);

        this.margin = { top: 10, right: 20, bottom: 20, left: 30 };
        this.canvasWidth = this.width - this.margin.left - this.margin.right;
        this.canvasHeight = this.height - this.margin.top - this.margin.bottom;

        this.node = svg.append("g")
            .attr("transform", `translate(${this.margin.left},${this.margin.top})`);

        this.lines = [];
        options.lines.forEach(line => {
            let lineOptions = Object.assign({}, line);
            lineOptions.chart = this;
            lineOptions.x = d3.scaleLinear().range([0, this.canvasWidth]);
            lineOptions.y = d3.scaleLinear().range([this.canvasHeight, 0]);
            this.xScale = this.xScale ?? lineOptions.x;
            this.yScale = this.yScale ?? lineOptions.y;
            // TODO: determine y range
            this.lines.push(new ChartLine(lineOptions));
        });

        this.ruler = this.node.append('g')
            .append('line')
                .style("fill", "none")
                .attr("stroke", "black")
                .attr("stroke-width", 1.5)
                .attr('x1', 0)
                .attr('x2', 0)
                .attr('y1', this.canvasHeight)
                .attr('y2', 0)
                .style("opacity", 0);
        this.hotbox = this.node.append('rect')
            .style("fill", "none")
            .style("pointer-events", "all")
            .attr('width', this.canvasWidth)
            .attr('height', this.canvasHeight)
            .on('mouseover', () => this.mouseOver())
            .on('mousemove', (e) => {
                e.preventDefault();
                let x = d3.pointers(e)[0][0],
                    t = this.xScale.invert(x);
                this.mouseMove(t);
            })
            .on('mouseout',  () => this.mouseOut());

        this.xAxis = this.node.append('g').attr("transform", `translate(0,${this.canvasHeight})`);
        if (!this.independentScale) {
            this.yAxis = this.node.append('g'); //.attr("transform", `translate(0,0)`);
        }
    }

    update (simulation) {
        this.lines.forEach(line => {
            line.update(simulation);
        });
        this.xAxis.call(d3.axisBottom(this.xScale));
        if (!this.independentScale) {
            this.yAxis.call(d3.axisLeft(this.yScale));
        }
    }

    showRuler () {
        this.ruler.style("opacity", 1);
    }

    hideRuler () {
        this.ruler.style("opacity", 0);
    }

    updateRuler (t) {
        //let i = bisect(data, t, 1);
        //let selectedData = data[i];
        //let x = this.xScale(selectedData.x);
        let x = this.xScale(t);
        this.ruler
            .attr("x1", x)
            .attr("x2", x);
    }
}

class ChartLine {
    constructor (options) {
        Object.assign(this, options); // ew h4x
        this.line = d3.line()
            .x(d => this.x(d.frame.t))
            .y(d => this.y(this.value(d)));
        this.node = this.chart.node.append('path')
            .attr("fill", "none")
            .attr("stroke", this.color)
            .attr("stroke-width", 1.5);
    }

    minY (data) {
        return d3.min(data, d => this.value(d));
    }

    maxY (data) {
        return d3.max(data, d => this.value(d));
    }

    maxAbsY (data) {
        return d3.max(data, d => Math.abs(this.value(d)));
    }

    update (simulation) {
        this.x.domain([d3.min(simulation.data, d => d.frame.t), d3.max(simulation.data, d => d.frame.t)]);
        if (this.chart.independentScale) {
            this.y.domain([-this.maxAbsY(simulation.data), this.maxAbsY(simulation.data)]);
        } else {
            this.y.domain([d3.min(this.chart.lines.map(line => line.minY(simulation.data))),
                           d3.max(this.chart.lines.map(line => line.maxY(simulation.data)))]);
        }
        this.node.attr("d", this.line(simulation.data));
    }
}

class ValuesChart extends SimulationChart {
    constructor (options) {
        super(Object.assign({}, options, {
            lines: [
                {
                    name: 'zero',
                    value: d => 0,
                    color: "grey",
                },
                {
                    name: 'sP',
                    value: d => d.frame.sP,
                    color: "steelblue",
                },
                {
                    name: 'measuredPV',
                    value: d => d.frame.pV,
                    color: "pink",
                },
                {
                    name: 'actualPV',
                    value: d => d.pV,
                    color: "red",
                },
                {
                    name: 'pMax',
                    value: d => d.pMax,
                    color: "green",
                },
                {
                    name: 'pMin',
                    value: d => d.pMin,
                    color: "green",
                },
            ],
        }));
    }
}

class ControlChart extends SimulationChart {
    constructor (options) {
        super(Object.assign({}, options, {
            lines: [
                {
                    name: 'zero',
                    value: d => 0,
                    color: "grey",
                },
                {
                    name: 'targetControl',
                    value: d => d.frame.control,
                    color: "skyblue",
                },
                {
                    name: 'restrictedControl',
                    value: d => d.restrictedControl,
                    color: "steelblue",
                },
                {
                    name: 'actualControl',
                    value: d => d.actualControl,
                    color: "magenta",
                },
                {
                    name: 'effectiveControl',
                    value: d => d.effectiveControl,
                    color: "green",
                },
            ],
        }));
    }
}

class StateChart extends SimulationChart {
    constructor (options) {
        super(Object.assign({}, options, {
            lines: [
                {
                    name: 'zero',
                    value: d => 0,
                    color: "grey",
                },
                {
                    name: 'error',
                    value: d => d.frame.error,
                    color: "red",
                },
                {
                    name: 'sumError',
                    value: d => d.frame.sumError,
                    color: "purple",
                },
                {
                    name: 'rateError',
                    value: d => d.frame.rateError,
                    color: "pink",
                },
            ],
        }));
    }
}

class ResultsDisplay {
    constructor() {
        let commonOptions = {
            mouseOver: () => this.showRuler(),
            mouseMove: t => this.updateRuler(t),
            mouseOut: () => this.hideRuler(),
        };
        this.displays = [
          this.simulationTable = new SimulationTable(Object.assign({}, commonOptions)),
          this.valuesChart = new ValuesChart(Object.assign({ selector: ".sim-chart", width: 1200, height: 300, }, commonOptions)),
          this.controlChart = new ControlChart(Object.assign({ selector: ".sim-chart", width: 1200, height: 150, independentScale: true, }, commonOptions)),
          this.stateChart = new StateChart(Object.assign({ selector: ".sim-chart", width: 1200, height: 150, independentScale: true, }, commonOptions)),
        ];
    }

    update (simulation) {
        this.displays.forEach(d => d.update(simulation));
    }

    showRuler () {
        this.displays.forEach(d => d.showRuler());
    }

    hideRuler () {
        this.displays.forEach(d => d.hideRuler());
    }

    updateRuler (t) {
        this.displays.forEach(d => d.updateRuler(t));
    }
}

class App {
    constructor () {
        this.parametersForm = document.querySelector(".parameters form");
        this.simulation = new Simulation(this.simulationOptions());
        this.resultsDisplay = new ResultsDisplay();

        this.parametersForm.addEventListener('change', event => this.update());
        //this.parametersForm.querySelectorAll("input").forEach(node => node.addEventListener('input', e => this.update()));
        this.parametersForm.querySelectorAll("input").forEach(node => node.addEventListener('keyup', event => this.parameterKeyListener(event)));
    }

    parameterKeyListener (event) {
        if (event.isComposing || event.keyCode === 229) {
            return;
        }
        //console.log(`keyUp ${event.code} on ${event.target}`);
        let val = Number.parseFloat(event.target.value);
        if (event.code == 'ArrowUp') {
            event.target.value = val + this.incStep(val);
        } else if (event.code == 'ArrowDown') {
            event.target.value = val - this.decStep(val);
        } else {
            return;
        }
        let changeEvent = new Event('change', { bubbles: true, cancellable: false });
        event.target.dispatchEvent(changeEvent);
    }

    namedInput (name) {
        return this.parametersForm.querySelector(`input[name='${name}']`);
    }

    namedParameter (name) {
        return this.namedInput(name).value;
    }

    floatParam (name) {
        return Number.parseFloat(this.namedParameter(name));
    }

    incStep (val) {
        // increment in 10ths steps.
        return 10 ** (Math.floor(Math.log10(val)) - 1);
    }

    decStep (val) {
        // decrement needs to see if it's stepping down to a smaller scale.
        let big = this.incStep(val), small = this.incStep(val - big);
        return Math.min(big, small);
    }

    simulationOptions () {
        return {
            initialPV: this.floatParam('initial_pv'),
            sP: this.floatParam('sp'),
            kP: this.floatParam('kp'),
            tI: this.floatParam('ti'),
            tD: this.floatParam('td'),
            dT: this.floatParam('dt'),
            saturationUp: this.floatParam('saturation_up'),
            saturationDown: this.floatParam('saturation_down'),
            actuationFactor: this.floatParam('actuation_factor'),
            authorityUp: this.floatParam('authority_up'),
            authorityDown: this.floatParam('authority_down'),
            measurementNoise: this.floatParam('measurement_noise'),
            duration: this.floatParam('duration'),
            drift: this.floatParam('drift'),
            setPoints: this.namedParameter('set_points'),

            decayingIntegral: this.namedInput('decaying_integral').checked,
            decayRate: this.floatParam('decay_rate'),
            decayThreshold: this.floatParam('decay_threshold'),

            asymmetricIntegral: this.namedInput('asymmetric_integral').checked,
            divergingRate: this.floatParam('diverging_rate'),
            convergingRate: this.floatParam('converging_rate'),

            pLimitIntegral: this.namedInput('plimit_integral').checked,

            rateErrorIgnoresSPChange: this.namedInput('rate_error_ignores_sp_change').checked,

            smoothedPV: this.namedInput('smoothed_pv').checked,
            smoothedPVFactor: this.floatParam('smoothed_pv_factor'),

            smoothedSP: this.namedInput('smoothed_sp').checked,
            smoothedSPFactor: this.floatParam('smoothed_sp_factor'),

            smoothedRateError: this.namedInput('smoothed_rate_error').checked,
            smoothedRateErrorFactor: this.floatParam('smoothed_rate_error_factor'),

            smoothedError: this.namedInput('smoothed_error').checked,
            smoothedErrorFactor: this.floatParam('smoothed_error_factor'),

            smoothedSumError: this.namedInput('smoothed_sum_error').checked,
            smoothedSumErrorFactor: this.floatParam('smoothed_sum_error_factor'),
        };
    }

    update () {
        console.log("Updating simulation.");
        this.simulation.configure(this.simulationOptions());
        this.simulation.reset();
        this.run();
    }

    run () {
        this.simulation.run();
        this.resultsDisplay.update(this.simulation);
    }
}


let app = new App();
window.app = app;

app.run();

})(document, window);

},{"../lib/behaviours/asymmetric-integral":2,"../lib/behaviours/basic":3,"../lib/behaviours/decaying-integral":4,"../lib/behaviours/plimit-integral":5,"../lib/behaviours/rate-error-ignores-sp-change":6,"../lib/behaviours/smooth-value":7,"../lib/pid":8}],2:[function(require,module,exports){
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

},{}],3:[function(require,module,exports){
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

},{}],4:[function(require,module,exports){
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

},{}],5:[function(require,module,exports){
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

},{}],6:[function(require,module,exports){
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

},{}],7:[function(require,module,exports){
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

},{}],8:[function(require,module,exports){
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

},{"./behaviours/basic":3,"perf_hooks":9}],9:[function(require,module,exports){

},{}]},{},[1])
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3Vzci9sb2NhbC9saWIvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXItcGFjay9fcHJlbHVkZS5qcyIsImJyb3dzZXIuanMiLCIuLi9saWIvYmVoYXZpb3Vycy9hc3ltbWV0cmljLWludGVncmFsLmpzIiwiLi4vbGliL2JlaGF2aW91cnMvYmFzaWMuanMiLCIuLi9saWIvYmVoYXZpb3Vycy9kZWNheWluZy1pbnRlZ3JhbC5qcyIsIi4uL2xpYi9iZWhhdmlvdXJzL3BsaW1pdC1pbnRlZ3JhbC5qcyIsIi4uL2xpYi9iZWhhdmlvdXJzL3JhdGUtZXJyb3ItaWdub3Jlcy1zcC1jaGFuZ2UuanMiLCIuLi9saWIvYmVoYXZpb3Vycy9zbW9vdGgtdmFsdWUuanMiLCIuLi9saWIvcGlkLmpzIiwiLi4vLi4vLi4vLi4vLi4vdXNyL2xvY2FsL2xpYi9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9saWIvX2VtcHR5LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdG5CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDckJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNuQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsSkEiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbigpe2Z1bmN0aW9uIHIoZSxuLHQpe2Z1bmN0aW9uIG8oaSxmKXtpZighbltpXSl7aWYoIWVbaV0pe3ZhciBjPVwiZnVuY3Rpb25cIj09dHlwZW9mIHJlcXVpcmUmJnJlcXVpcmU7aWYoIWYmJmMpcmV0dXJuIGMoaSwhMCk7aWYodSlyZXR1cm4gdShpLCEwKTt2YXIgYT1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK2krXCInXCIpO3Rocm93IGEuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixhfXZhciBwPW5baV09e2V4cG9ydHM6e319O2VbaV1bMF0uY2FsbChwLmV4cG9ydHMsZnVuY3Rpb24ocil7dmFyIG49ZVtpXVsxXVtyXTtyZXR1cm4gbyhufHxyKX0scCxwLmV4cG9ydHMscixlLG4sdCl9cmV0dXJuIG5baV0uZXhwb3J0c31mb3IodmFyIHU9XCJmdW5jdGlvblwiPT10eXBlb2YgcmVxdWlyZSYmcmVxdWlyZSxpPTA7aTx0Lmxlbmd0aDtpKyspbyh0W2ldKTtyZXR1cm4gb31yZXR1cm4gcn0pKCkiLCIvKiBqc2hpbnQgZXN2ZXJzaW9uOiA5LCBub2RlOiB0cnVlICovXG5cInVzZSBzdHJpY3RcIjtcblxuKGZ1bmN0aW9uIChkb2N1bWVudCwgd2luZG93LCB1bmRlZmluZWQpIHtcblxuY29uc3QgeyBQSUQgfSA9IHJlcXVpcmUoJy4uL2xpYi9waWQnKTtcbmNvbnN0IHsgQmFzaWMgfSA9IHJlcXVpcmUoJy4uL2xpYi9iZWhhdmlvdXJzL2Jhc2ljJyk7XG5jb25zdCB7IERlY2F5aW5nSW50ZWdyYWwgfSA9IHJlcXVpcmUoJy4uL2xpYi9iZWhhdmlvdXJzL2RlY2F5aW5nLWludGVncmFsJyk7XG5jb25zdCB7IEFzeW1tZXRyaWNJbnRlZ3JhbCB9ID0gcmVxdWlyZSgnLi4vbGliL2JlaGF2aW91cnMvYXN5bW1ldHJpYy1pbnRlZ3JhbCcpO1xuY29uc3QgeyBQTGltaXRJbnRlZ3JhbCB9ID0gcmVxdWlyZSgnLi4vbGliL2JlaGF2aW91cnMvcGxpbWl0LWludGVncmFsJyk7XG5jb25zdCB7IFJhdGVFcnJvcklnbm9yZXNTUENoYW5nZSB9ID0gcmVxdWlyZSgnLi4vbGliL2JlaGF2aW91cnMvcmF0ZS1lcnJvci1pZ25vcmVzLXNwLWNoYW5nZScpO1xuY29uc3QgeyBTbW9vdGhWYWx1ZSB9ID0gcmVxdWlyZSgnLi4vbGliL2JlaGF2aW91cnMvc21vb3RoLXZhbHVlJyk7XG5cbmNsYXNzIFNpbXVsYXRpb24ge1xuICAgIGNvbnN0cnVjdG9yIChvcHRpb25zKSB7XG4gICAgICAgIHRoaXMubm9pc2VTZXF1ZW5jZSA9IG5ldyBBcnJheSgxMDAwKS5maWxsKDApLm1hcCh2ID0+IChNYXRoLnJhbmRvbSgpICsgTWF0aC5yYW5kb20oKSkgKiAwLjUpO1xuICAgICAgICB0aGlzLmNvbmZpZ3VyZShvcHRpb25zKTtcbiAgICAgICAgdGhpcy5yZXNldCgpO1xuICAgIH1cblxuICAgIGNvbmZpZ3VyZSAob3B0aW9ucykge1xuICAgICAgICB0aGlzLnNQID0gb3B0aW9ucy5zUDtcbiAgICAgICAgdGhpcy5wViA9IG9wdGlvbnMuaW5pdGlhbFBWO1xuICAgICAgICB0aGlzLm1lYXN1cmVtZW50Tm9pc2UgPSBvcHRpb25zLm1lYXN1cmVtZW50Tm9pc2U7XG4gICAgICAgIHRoaXMuY29udHJvbCA9IDA7IC8vIHRhcmdldCBjb250cm9sXG4gICAgICAgIHRoaXMucmVzdHJpY3RlZENvbnRyb2wgPSAwOyAvLyB0YXJnZXQgY29udHJvbCByZXN0cmljdGVkIHRvIHNhdHVyYXRpb25cbiAgICAgICAgdGhpcy5hY3R1YWxDb250cm9sID0gMDsgLy8gYWN0dWFsIGN1cnJlbnQgY29udHJvbCBzdWJqZWN0IHRvIGFjdHVhdGlvbiBkZWxheVxuICAgICAgICB0aGlzLmVmZmVjdGl2ZUNvbnRyb2wgPSAwOyAvLyBhY3R1YWwgZWZmZWN0aXZlIGN1cnJlbnQgY29udHJvbFxuICAgICAgICB0aGlzLmRUID0gb3B0aW9ucy5kVDtcbiAgICAgICAgdGhpcy5zYXR1cmF0aW9uID0gW29wdGlvbnMuc2F0dXJhdGlvbkRvd24sIG9wdGlvbnMuc2F0dXJhdGlvblVwXTtcbiAgICAgICAgdGhpcy5hY3R1YXRpb25GYWN0b3IgPSBvcHRpb25zLmFjdHVhdGlvbkZhY3RvcjtcbiAgICAgICAgdGhpcy5hdXRob3JpdHkgPSBbb3B0aW9ucy5hdXRob3JpdHlEb3duLCBvcHRpb25zLmF1dGhvcml0eVVwXTtcbiAgICAgICAgdGhpcy5kdXJhdGlvbiA9IG9wdGlvbnMuZHVyYXRpb247XG4gICAgICAgIHRoaXMuZHJpZnQgPSBvcHRpb25zLmRyaWZ0O1xuXG4gICAgICAgIHRoaXMuc2V0UG9pbnRzID0gdGhpcy5wYXJzZVNldFBvaW50cyhvcHRpb25zLnNldFBvaW50cyk7XG4gICAgICAgIHRoaXMubmV4dFNldFBvaW50ID0gMDtcblxuICAgICAgICBsZXQgYmVoYXZpb3VycyA9IFtuZXcgQmFzaWMoKV07XG4gICAgICAgIGlmIChvcHRpb25zLmRlY2F5aW5nSW50ZWdyYWwpIHtcbiAgICAgICAgICAgIGJlaGF2aW91cnMucHVzaChuZXcgRGVjYXlpbmdJbnRlZ3JhbCh7XG4gICAgICAgICAgICAgICAgZGVjYXlSYXRlOiBvcHRpb25zLmRlY2F5UmF0ZSxcbiAgICAgICAgICAgICAgICB0aHJlc2hvbGQ6IG9wdGlvbnMuZGVjYXlUaHJlc2hvbGQsXG4gICAgICAgICAgICB9KSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG9wdGlvbnMuYXN5bW1ldHJpY0ludGVncmFsKSB7XG4gICAgICAgICAgICBiZWhhdmlvdXJzLnB1c2gobmV3IEFzeW1tZXRyaWNJbnRlZ3JhbCh7XG4gICAgICAgICAgICAgICAgZGl2ZXJnaW5nUmF0ZTogb3B0aW9ucy5kaXZlcmdpbmdSYXRlLFxuICAgICAgICAgICAgICAgIGNvbnZlcmdpbmdSYXRlOiBvcHRpb25zLmNvbnZlcmdpbmdSYXRlLFxuICAgICAgICAgICAgfSkpO1xuICAgICAgICB9XG4gICAgICAgIC8vIFNob3VsZCBhbHdheXMgYmUgbGFzdCBvZiB0aGUgaW50ZWdyYWwgYmVoYXZpb3Vycy5cbiAgICAgICAgaWYgKG9wdGlvbnMucExpbWl0SW50ZWdyYWwpIHtcbiAgICAgICAgICAgIGJlaGF2aW91cnMucHVzaChuZXcgUExpbWl0SW50ZWdyYWwoe1xuICAgICAgICAgICAgfSkpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChvcHRpb25zLnJhdGVFcnJvcklnbm9yZXNTUENoYW5nZSkge1xuICAgICAgICAgICAgYmVoYXZpb3Vycy5wdXNoKG5ldyBSYXRlRXJyb3JJZ25vcmVzU1BDaGFuZ2Uoe1xuICAgICAgICAgICAgfSkpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChvcHRpb25zLnNtb290aGVkUFYpIHtcbiAgICAgICAgICAgIGJlaGF2aW91cnMucHVzaChuZXcgU21vb3RoVmFsdWUoe1xuICAgICAgICAgICAgICAgIHNtb290aEZhY3Rvcjogb3B0aW9ucy5zbW9vdGhlZFBWRmFjdG9yLFxuICAgICAgICAgICAgICAgIHZhbHVlOiAncFYnLFxuICAgICAgICAgICAgfSkpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChvcHRpb25zLnNtb290aGVkU1ApIHtcbiAgICAgICAgICAgIGJlaGF2aW91cnMucHVzaChuZXcgU21vb3RoVmFsdWUoe1xuICAgICAgICAgICAgICAgIHNtb290aEZhY3Rvcjogb3B0aW9ucy5zbW9vdGhlZFNQRmFjdG9yLFxuICAgICAgICAgICAgICAgIHZhbHVlOiAnc1AnLFxuICAgICAgICAgICAgfSkpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChvcHRpb25zLnNtb290aGVkUmF0ZUVycm9yKSB7XG4gICAgICAgICAgICBiZWhhdmlvdXJzLnB1c2gobmV3IFNtb290aFZhbHVlKHtcbiAgICAgICAgICAgICAgICBzbW9vdGhGYWN0b3I6IG9wdGlvbnMuc21vb3RoZWRSYXRlRXJyb3JGYWN0b3IsXG4gICAgICAgICAgICAgICAgdmFsdWU6ICdyYXRlRXJyb3InLFxuICAgICAgICAgICAgfSkpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChvcHRpb25zLnNtb290aGVkRXJyb3IpIHtcbiAgICAgICAgICAgIGJlaGF2aW91cnMucHVzaChuZXcgU21vb3RoVmFsdWUoe1xuICAgICAgICAgICAgICAgIHNtb290aEZhY3Rvcjogb3B0aW9ucy5zbW9vdGhlZEVycm9yRmFjdG9yLFxuICAgICAgICAgICAgICAgIHZhbHVlOiAnZXJyb3InLFxuICAgICAgICAgICAgfSkpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChvcHRpb25zLnNtb290aGVkU3VtRXJyb3IpIHtcbiAgICAgICAgICAgIGJlaGF2aW91cnMucHVzaChuZXcgU21vb3RoVmFsdWUoe1xuICAgICAgICAgICAgICAgIHNtb290aEZhY3Rvcjogb3B0aW9ucy5zbW9vdGhlZFN1bUVycm9yRmFjdG9yLFxuICAgICAgICAgICAgICAgIHZhbHVlOiAnc3VtRXJyb3InLFxuICAgICAgICAgICAgfSkpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5waWQgPSBuZXcgUElEKHtcbiAgICAgICAgICB0OiAwLFxuICAgICAgICAgIGtQOiBvcHRpb25zLmtQLFxuICAgICAgICAgIHRJOiBvcHRpb25zLnRJLFxuICAgICAgICAgIHREOiBvcHRpb25zLnRELFxuICAgICAgICAgIGJlaGF2aW91cnM6IGJlaGF2aW91cnMsXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHJlc2V0ICgpIHtcbiAgICAgICAgdGhpcy5ub2lzZU9mZnNldCA9IDA7XG4gICAgICAgIHRoaXMudCA9IDA7XG4gICAgICAgIHRoaXMuZGF0YSA9IFtdO1xuICAgICAgICB0aGlzLnBpZC5yZXNldCh0aGlzLnQpO1xuICAgICAgICB0aGlzLnBpZC5zUCA9IHRoaXMuc1A7XG5cbiAgICAgICAgLy8gRklYTUU6IHNob3VsZCBwdXNoIGFuIGluaXRpYWwgZGF0YSBmcmFtZS5cbiAgICB9XG5cbiAgICBwYXJzZVNldFBvaW50cyAoc2VxdWVuY2UpIHtcbiAgICAgICAgcmV0dXJuIHNlcXVlbmNlLnNwbGl0KCcsJylcbiAgICAgICAgICAgIC5tYXAoc2VnbWVudCA9PiBzZWdtZW50LnNwbGl0KCdAJykpXG4gICAgICAgICAgICAubWFwKChbdmFsdWUsIHdoZW5dKSA9PiB7IHJldHVybiB7IHdoZW46IE51bWJlci5wYXJzZUZsb2F0KHdoZW4pLCB2YWx1ZTogTnVtYmVyLnBhcnNlRmxvYXQodmFsdWUpIH0gfSk7XG4gICAgfVxuXG4gICAgbm9pc2VGYWN0b3IgKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5ub2lzZVNlcXVlbmNlW3RoaXMubm9pc2VPZmZzZXQrKyAlIHRoaXMubm9pc2VTZXF1ZW5jZS5sZW5ndGhdO1xuICAgIH1cblxuICAgIG5vaXNlIChuKSB7XG4gICAgICAgIHJldHVybiAoMiAqIG4gKiB0aGlzLm5vaXNlRmFjdG9yKCkpIC0gbjtcbiAgICB9XG5cbiAgICBtZWFzdXJlZFBWICgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMucFYgKyB0aGlzLm5vaXNlKHRoaXMubWVhc3VyZW1lbnROb2lzZSk7XG4gICAgfVxuXG4gICAgdXBkYXRlIChkVCkge1xuICAgICAgICB0aGlzLnQgKz0gZFQ7XG5cbiAgICAgICAgLy8gQXBwbHkgY29udHJvbCB0byBcInNpbXVsYXRpb25cIlxuICAgICAgICB0aGlzLnBWICs9IHRoaXMuZWZmZWN0aXZlQ29udHJvbCAqIGRUO1xuXG4gICAgICAgIC8vIEFwcGx5IGRyaWZ0LlxuICAgICAgICB0aGlzLnBWICs9IHRoaXMuZHJpZnQgKiBkVDtcblxuICAgICAgICAvLyBBcHBseSBjaGFuZ2VzIGluIHNldCBwb2ludC5cbiAgICAgICAgaWYgKCh0aGlzLm5leHRTZXRQb2ludCA8IHRoaXMuc2V0UG9pbnRzLmxlbmd0aCkgJiYgKHRoaXMuc2V0UG9pbnRzW3RoaXMubmV4dFNldFBvaW50XS53aGVuIDw9IHRoaXMudCkpIHtcbiAgICAgICAgICAgIHRoaXMuc1AgPSB0aGlzLnBpZC5zUCA9IHRoaXMuc2V0UG9pbnRzW3RoaXMubmV4dFNldFBvaW50XS52YWx1ZTtcbiAgICAgICAgICAgIHRoaXMubmV4dFNldFBvaW50Kys7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBVcGRhdGUgYW5kIGRpc3BsYXkgUElELlxuICAgICAgICB0aGlzLmNvbnRyb2wgPSB0aGlzLnBpZC51cGRhdGUodGhpcy5tZWFzdXJlZFBWKCksIHRoaXMudCk7XG5cbiAgICAgICAgdGhpcy5yZXN0cmljdGVkQ29udHJvbCA9IHRoaXMuY29udHJvbDtcbiAgICAgICAgaWYgKHRoaXMucmVzdHJpY3RlZENvbnRyb2wgPCAwKSB7XG4gICAgICAgICAgICBpZiAodGhpcy5zYXR1cmF0aW9uWzBdICE9PSBudWxsICYmIHRoaXMucmVzdHJpY3RlZENvbnRyb2wgPCB0aGlzLnNhdHVyYXRpb25bMF0pIHtcbiAgICAgICAgICAgICAgICB0aGlzLnJlc3RyaWN0ZWRDb250cm9sID0gdGhpcy5zYXR1cmF0aW9uWzBdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5hY3R1YWxDb250cm9sICs9ICh0aGlzLnJlc3RyaWN0ZWRDb250cm9sIC0gdGhpcy5hY3R1YWxDb250cm9sKSAqIHRoaXMuYWN0dWF0aW9uRmFjdG9yO1xuICAgICAgICAgICAgdGhpcy5lZmZlY3RpdmVDb250cm9sID0gdGhpcy5hY3R1YWxDb250cm9sICogdGhpcy5hdXRob3JpdHlbMF07XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBpZiAodGhpcy5zYXR1cmF0aW9uWzFdICE9PSBudWxsICYmIHRoaXMucmVzdHJpY3RlZENvbnRyb2wgPiB0aGlzLnNhdHVyYXRpb25bMV0pIHtcbiAgICAgICAgICAgICAgICB0aGlzLnJlc3RyaWN0ZWRDb250cm9sID0gdGhpcy5zYXR1cmF0aW9uWzFdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5hY3R1YWxDb250cm9sICs9ICh0aGlzLnJlc3RyaWN0ZWRDb250cm9sIC0gdGhpcy5hY3R1YWxDb250cm9sKSAqIHRoaXMuYWN0dWF0aW9uRmFjdG9yO1xuICAgICAgICAgICAgdGhpcy5lZmZlY3RpdmVDb250cm9sID0gdGhpcy5hY3R1YWxDb250cm9sICogdGhpcy5hdXRob3JpdHlbMV07XG4gICAgICAgIH1cblxuICAgICAgICBsZXQgZnJhbWUgPSB0aGlzLnBpZC51cGRhdGVGcmFtZXNbMF07XG5cbiAgICAgICAgdGhpcy5kYXRhLnB1c2goe1xuICAgICAgICAgICAgZnJhbWU6IGZyYW1lLFxuICAgICAgICAgICAgcFY6IHRoaXMucFYsIC8vIGFjdHVhbCBwVlxuICAgICAgICAgICAgcmVzdHJpY3RlZENvbnRyb2w6IHRoaXMucmVzdHJpY3RlZENvbnRyb2wsXG4gICAgICAgICAgICBhY3R1YWxDb250cm9sOiAgICAgdGhpcy5hY3R1YWxDb250cm9sLFxuICAgICAgICAgICAgZWZmZWN0aXZlQ29udHJvbDogIHRoaXMuZWZmZWN0aXZlQ29udHJvbCxcbiAgICAgICAgICAgIHBNYXg6IHRoaXMucGlkLnBNYXgoKSxcbiAgICAgICAgICAgIHBNaW46IHRoaXMucGlkLnBNaW4oKSxcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcnVuICgpIHtcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aGlzLmR1cmF0aW9uOyBpICs9IHRoaXMuZFQpIHtcbiAgICAgICAgICAgIHRoaXMudXBkYXRlKHRoaXMuZFQpO1xuICAgICAgICB9XG4gICAgfVxufVxuXG5jbGFzcyBTaW11bGF0aW9uVGFibGUge1xuICAgIGNvbnN0cnVjdG9yIChvcHRpb25zID0ge30pIHtcbiAgICAgICAgY29uc3QgdGFibGUgPSBkMy5zZWxlY3QoXCIuc2ltLXRhYmxlXCIpLmFwcGVuZChcInRhYmxlXCIpXG5cbiAgICAgICAgdGFibGUuYXBwZW5kKFwidGhlYWRcIikuaHRtbChgPHRyPlxuICAgICAgICAgICAgPHRoPlQ8L3RoPlxuICAgICAgICAgICAgPHRoPnNQPC90aD5cbiAgICAgICAgICAgIDx0aD5wVjwvdGg+XG4gICAgICAgICAgICA8dGg+ZXJyb3I8L3RoPlxuICAgICAgICAgICAgPHRoPnN1bUVycm9yPC90aD5cbiAgICAgICAgICAgIDx0aD5yYXRlRXJyb3I8L3RoPlxuICAgICAgICAgICAgPHRoPmNvbnRyb2w8L3RoPlxuICAgICAgICAgICAgPHRoPnJlc3RyaWN0ZWRDb250cm9sPC90aD5cbiAgICAgICAgICAgIDx0aD5hY3R1YWxDb250cm9sPC90aD5cbiAgICAgICAgICAgIDx0aD5lZmZlY3RpdmVDb250cm9sPC90aD5cbiAgICAgICAgPC90cj5gKTtcblxuICAgICAgICB0aGlzLm5vZGUgPSB0YWJsZS5hcHBlbmQoXCJ0Ym9keVwiKTtcbiAgICB9XG5cbiAgICB1cGRhdGUgKHNpbXVsYXRpb24pIHtcbiAgICAgICAgY29uc3QgZGF0YVJvdyA9IChkKSA9PiB7XG4gICAgICAgICAgICByZXR1cm4gYFxuICAgICAgICAgICAgICAgIDx0ZCBzdHlsZT1cInRleHQtYWxpZ246IGxlZnQ7XCI+JHtkLmZyYW1lLnR9PC90ZD5cbiAgICAgICAgICAgICAgICA8dGQ+JHtkLmZyYW1lLnNQfTwvdGQ+XG4gICAgICAgICAgICAgICAgPHRkPiR7ZC5mcmFtZS5wVn08L3RkPlxuICAgICAgICAgICAgICAgIDx0ZD4ke2QuZnJhbWUuZXJyb3J9PC90ZD5cbiAgICAgICAgICAgICAgICA8dGQ+JHtkLmZyYW1lLnN1bUVycm9yfTwvdGQ+XG4gICAgICAgICAgICAgICAgPHRkPiR7ZC5mcmFtZS5yYXRlRXJyb3J9PC90ZD5cbiAgICAgICAgICAgICAgICA8dGQ+JHtkLmZyYW1lLmNvbnRyb2x9PC90ZD5cbiAgICAgICAgICAgICAgICA8dGQ+JHtkLnJlc3RyaWN0ZWRDb250cm9sfTwvdGQ+XG4gICAgICAgICAgICAgICAgPHRkPiR7ZC5hY3R1YWxDb250cm9sfTwvdGQ+XG4gICAgICAgICAgICAgICAgPHRkPiR7ZC5lZmZlY3RpdmVDb250cm9sfTwvdGQ+XG4gICAgICAgICAgICBgO1xuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IHRyID0gdGhpcy5ub2RlLnNlbGVjdEFsbChcInRyXCIpXG4gICAgICAgICAgICAuZGF0YShzaW11bGF0aW9uLmRhdGEpXG4gICAgICAgICAgICAuaHRtbChkYXRhUm93KTtcblxuICAgICAgICB0ci5lbnRlcigpLmFwcGVuZCgndHInKVxuICAgICAgICAgICAgLmh0bWwoZGF0YVJvdyk7XG5cbiAgICAgICAgdHIuZXhpdCgpLnJlbW92ZSgpO1xuXG4gICAgICAgIC8vIEEgY2xvc3VyZSBvdmVyIHRoZSBjdXJyZW50IHNpbXVsYXRpb24uZGF0YSBhY3RpbmcgYXMgYSBmYWN0b3J5IGZvclxuICAgICAgICAvLyBhbiBpbW1lZGlhdGVseS1pbnZva2VkIGJpc2VjdG9yLCBTVVJFIHRoYXQncyB0aGUgc2ltcGxlIHdheSBvZiBkb2luZyB0aGlzLlxuICAgICAgICB0aGlzLmJpc2VjdCA9ICh0KSA9PiBkMy5iaXNlY3RvcihkID0+IGQuZnJhbWUudCkubGVmdChzaW11bGF0aW9uLmRhdGEsIHQsIDEpO1xuICAgIH1cblxuICAgIHNob3dSdWxlciAoKSB7XG4gICAgfVxuXG4gICAgaGlkZVJ1bGVyICgpIHtcbiAgICB9XG5cbiAgICB1cGRhdGVSdWxlciAodCkge1xuICAgICAgICBjb25zdCBpID0gdGhpcy5iaXNlY3QodCk7XG4gICAgICAgIGNvbnN0IG5vZGVzID0gdGhpcy5ub2RlLnNlbGVjdEFsbChcInRyXCIpLm5vZGVzKCk7XG4gICAgICAgIGNvbnN0IHRhcmdldE5vZGUgPSBub2Rlc1tpXTtcbiAgICAgICAgLy9jb25zb2xlLmxvZyhgU2Nyb2xsaW5nIHRvIHQke3R9IHJvdyAke2l9IHdpdGggb2Zmc2V0ICR7dGFyZ2V0Tm9kZS5vZmZzZXRUb3B9cHhgLCB0YXJnZXROb2RlKTtcbiAgICAgICAgbm9kZXMuZm9yRWFjaCgobm9kZSwgaWR4KSA9PiB7XG4gICAgICAgICAgICBub2RlLmNsYXNzTmFtZSA9IGlkeCA9PSBpID8gJ2hpZ2hsaWdodCcgOiAnJztcbiAgICAgICAgfSk7XG4gICAgICAgIC8vIFNVUkUgdGhpcyBpcyBtYWludGFpbmFibGUuXG4gICAgICAgIHRoaXMubm9kZS5ub2RlKCkucGFyZW50Tm9kZS5wYXJlbnROb2RlLnNjcm9sbFRvKDAsIHRhcmdldE5vZGUub2Zmc2V0VG9wIC0gMTAwKTtcbiAgICB9XG59XG5cbmNsYXNzIFNpbXVsYXRpb25DaGFydCB7XG4gICAgY29uc3RydWN0b3IgKG9wdGlvbnMgPSB7fSkge1xuICAgICAgICB0aGlzLnNlbGVjdG9yID0gb3B0aW9ucy5zZWxlY3RvcjtcbiAgICAgICAgdGhpcy53aWR0aCA9IG9wdGlvbnMud2lkdGg7XG4gICAgICAgIHRoaXMuaGVpZ2h0ID0gb3B0aW9ucy5oZWlnaHQ7XG4gICAgICAgIHRoaXMuaW5kZXBlbmRlbnRTY2FsZSA9IG9wdGlvbnMuaW5kZXBlbmRlbnRTY2FsZTtcbiAgICAgICAgdGhpcy5tb3VzZU92ZXIgPSBvcHRpb25zLm1vdXNlT3ZlcjtcbiAgICAgICAgdGhpcy5tb3VzZU1vdmUgPSBvcHRpb25zLm1vdXNlTW92ZTtcbiAgICAgICAgdGhpcy5tb3VzZU91dCA9IG9wdGlvbnMubW91c2VPdXQ7XG5cbiAgICAgICAgY29uc3Qgc3ZnID0gZDMuc2VsZWN0KHRoaXMuc2VsZWN0b3IpLmFwcGVuZChcInN2Z1wiKVxuICAgICAgICBzdmcuYXR0cihcIndpZHRoXCIsIHRoaXMud2lkdGgpXG4gICAgICAgICAgICAuYXR0cihcImhlaWdodFwiLCB0aGlzLmhlaWdodCk7XG5cbiAgICAgICAgdGhpcy5tYXJnaW4gPSB7IHRvcDogMTAsIHJpZ2h0OiAyMCwgYm90dG9tOiAyMCwgbGVmdDogMzAgfTtcbiAgICAgICAgdGhpcy5jYW52YXNXaWR0aCA9IHRoaXMud2lkdGggLSB0aGlzLm1hcmdpbi5sZWZ0IC0gdGhpcy5tYXJnaW4ucmlnaHQ7XG4gICAgICAgIHRoaXMuY2FudmFzSGVpZ2h0ID0gdGhpcy5oZWlnaHQgLSB0aGlzLm1hcmdpbi50b3AgLSB0aGlzLm1hcmdpbi5ib3R0b207XG5cbiAgICAgICAgdGhpcy5ub2RlID0gc3ZnLmFwcGVuZChcImdcIilcbiAgICAgICAgICAgIC5hdHRyKFwidHJhbnNmb3JtXCIsIGB0cmFuc2xhdGUoJHt0aGlzLm1hcmdpbi5sZWZ0fSwke3RoaXMubWFyZ2luLnRvcH0pYCk7XG5cbiAgICAgICAgdGhpcy5saW5lcyA9IFtdO1xuICAgICAgICBvcHRpb25zLmxpbmVzLmZvckVhY2gobGluZSA9PiB7XG4gICAgICAgICAgICBsZXQgbGluZU9wdGlvbnMgPSBPYmplY3QuYXNzaWduKHt9LCBsaW5lKTtcbiAgICAgICAgICAgIGxpbmVPcHRpb25zLmNoYXJ0ID0gdGhpcztcbiAgICAgICAgICAgIGxpbmVPcHRpb25zLnggPSBkMy5zY2FsZUxpbmVhcigpLnJhbmdlKFswLCB0aGlzLmNhbnZhc1dpZHRoXSk7XG4gICAgICAgICAgICBsaW5lT3B0aW9ucy55ID0gZDMuc2NhbGVMaW5lYXIoKS5yYW5nZShbdGhpcy5jYW52YXNIZWlnaHQsIDBdKTtcbiAgICAgICAgICAgIHRoaXMueFNjYWxlID0gdGhpcy54U2NhbGUgPz8gbGluZU9wdGlvbnMueDtcbiAgICAgICAgICAgIHRoaXMueVNjYWxlID0gdGhpcy55U2NhbGUgPz8gbGluZU9wdGlvbnMueTtcbiAgICAgICAgICAgIC8vIFRPRE86IGRldGVybWluZSB5IHJhbmdlXG4gICAgICAgICAgICB0aGlzLmxpbmVzLnB1c2gobmV3IENoYXJ0TGluZShsaW5lT3B0aW9ucykpO1xuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLnJ1bGVyID0gdGhpcy5ub2RlLmFwcGVuZCgnZycpXG4gICAgICAgICAgICAuYXBwZW5kKCdsaW5lJylcbiAgICAgICAgICAgICAgICAuc3R5bGUoXCJmaWxsXCIsIFwibm9uZVwiKVxuICAgICAgICAgICAgICAgIC5hdHRyKFwic3Ryb2tlXCIsIFwiYmxhY2tcIilcbiAgICAgICAgICAgICAgICAuYXR0cihcInN0cm9rZS13aWR0aFwiLCAxLjUpXG4gICAgICAgICAgICAgICAgLmF0dHIoJ3gxJywgMClcbiAgICAgICAgICAgICAgICAuYXR0cigneDInLCAwKVxuICAgICAgICAgICAgICAgIC5hdHRyKCd5MScsIHRoaXMuY2FudmFzSGVpZ2h0KVxuICAgICAgICAgICAgICAgIC5hdHRyKCd5MicsIDApXG4gICAgICAgICAgICAgICAgLnN0eWxlKFwib3BhY2l0eVwiLCAwKTtcbiAgICAgICAgdGhpcy5ob3Rib3ggPSB0aGlzLm5vZGUuYXBwZW5kKCdyZWN0JylcbiAgICAgICAgICAgIC5zdHlsZShcImZpbGxcIiwgXCJub25lXCIpXG4gICAgICAgICAgICAuc3R5bGUoXCJwb2ludGVyLWV2ZW50c1wiLCBcImFsbFwiKVxuICAgICAgICAgICAgLmF0dHIoJ3dpZHRoJywgdGhpcy5jYW52YXNXaWR0aClcbiAgICAgICAgICAgIC5hdHRyKCdoZWlnaHQnLCB0aGlzLmNhbnZhc0hlaWdodClcbiAgICAgICAgICAgIC5vbignbW91c2VvdmVyJywgKCkgPT4gdGhpcy5tb3VzZU92ZXIoKSlcbiAgICAgICAgICAgIC5vbignbW91c2Vtb3ZlJywgKGUpID0+IHtcbiAgICAgICAgICAgICAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICAgICAgbGV0IHggPSBkMy5wb2ludGVycyhlKVswXVswXSxcbiAgICAgICAgICAgICAgICAgICAgdCA9IHRoaXMueFNjYWxlLmludmVydCh4KTtcbiAgICAgICAgICAgICAgICB0aGlzLm1vdXNlTW92ZSh0KTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAub24oJ21vdXNlb3V0JywgICgpID0+IHRoaXMubW91c2VPdXQoKSk7XG5cbiAgICAgICAgdGhpcy54QXhpcyA9IHRoaXMubm9kZS5hcHBlbmQoJ2cnKS5hdHRyKFwidHJhbnNmb3JtXCIsIGB0cmFuc2xhdGUoMCwke3RoaXMuY2FudmFzSGVpZ2h0fSlgKTtcbiAgICAgICAgaWYgKCF0aGlzLmluZGVwZW5kZW50U2NhbGUpIHtcbiAgICAgICAgICAgIHRoaXMueUF4aXMgPSB0aGlzLm5vZGUuYXBwZW5kKCdnJyk7IC8vLmF0dHIoXCJ0cmFuc2Zvcm1cIiwgYHRyYW5zbGF0ZSgwLDApYCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB1cGRhdGUgKHNpbXVsYXRpb24pIHtcbiAgICAgICAgdGhpcy5saW5lcy5mb3JFYWNoKGxpbmUgPT4ge1xuICAgICAgICAgICAgbGluZS51cGRhdGUoc2ltdWxhdGlvbik7XG4gICAgICAgIH0pO1xuICAgICAgICB0aGlzLnhBeGlzLmNhbGwoZDMuYXhpc0JvdHRvbSh0aGlzLnhTY2FsZSkpO1xuICAgICAgICBpZiAoIXRoaXMuaW5kZXBlbmRlbnRTY2FsZSkge1xuICAgICAgICAgICAgdGhpcy55QXhpcy5jYWxsKGQzLmF4aXNMZWZ0KHRoaXMueVNjYWxlKSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBzaG93UnVsZXIgKCkge1xuICAgICAgICB0aGlzLnJ1bGVyLnN0eWxlKFwib3BhY2l0eVwiLCAxKTtcbiAgICB9XG5cbiAgICBoaWRlUnVsZXIgKCkge1xuICAgICAgICB0aGlzLnJ1bGVyLnN0eWxlKFwib3BhY2l0eVwiLCAwKTtcbiAgICB9XG5cbiAgICB1cGRhdGVSdWxlciAodCkge1xuICAgICAgICAvL2xldCBpID0gYmlzZWN0KGRhdGEsIHQsIDEpO1xuICAgICAgICAvL2xldCBzZWxlY3RlZERhdGEgPSBkYXRhW2ldO1xuICAgICAgICAvL2xldCB4ID0gdGhpcy54U2NhbGUoc2VsZWN0ZWREYXRhLngpO1xuICAgICAgICBsZXQgeCA9IHRoaXMueFNjYWxlKHQpO1xuICAgICAgICB0aGlzLnJ1bGVyXG4gICAgICAgICAgICAuYXR0cihcIngxXCIsIHgpXG4gICAgICAgICAgICAuYXR0cihcIngyXCIsIHgpO1xuICAgIH1cbn1cblxuY2xhc3MgQ2hhcnRMaW5lIHtcbiAgICBjb25zdHJ1Y3RvciAob3B0aW9ucykge1xuICAgICAgICBPYmplY3QuYXNzaWduKHRoaXMsIG9wdGlvbnMpOyAvLyBldyBoNHhcbiAgICAgICAgdGhpcy5saW5lID0gZDMubGluZSgpXG4gICAgICAgICAgICAueChkID0+IHRoaXMueChkLmZyYW1lLnQpKVxuICAgICAgICAgICAgLnkoZCA9PiB0aGlzLnkodGhpcy52YWx1ZShkKSkpO1xuICAgICAgICB0aGlzLm5vZGUgPSB0aGlzLmNoYXJ0Lm5vZGUuYXBwZW5kKCdwYXRoJylcbiAgICAgICAgICAgIC5hdHRyKFwiZmlsbFwiLCBcIm5vbmVcIilcbiAgICAgICAgICAgIC5hdHRyKFwic3Ryb2tlXCIsIHRoaXMuY29sb3IpXG4gICAgICAgICAgICAuYXR0cihcInN0cm9rZS13aWR0aFwiLCAxLjUpO1xuICAgIH1cblxuICAgIG1pblkgKGRhdGEpIHtcbiAgICAgICAgcmV0dXJuIGQzLm1pbihkYXRhLCBkID0+IHRoaXMudmFsdWUoZCkpO1xuICAgIH1cblxuICAgIG1heFkgKGRhdGEpIHtcbiAgICAgICAgcmV0dXJuIGQzLm1heChkYXRhLCBkID0+IHRoaXMudmFsdWUoZCkpO1xuICAgIH1cblxuICAgIG1heEFic1kgKGRhdGEpIHtcbiAgICAgICAgcmV0dXJuIGQzLm1heChkYXRhLCBkID0+IE1hdGguYWJzKHRoaXMudmFsdWUoZCkpKTtcbiAgICB9XG5cbiAgICB1cGRhdGUgKHNpbXVsYXRpb24pIHtcbiAgICAgICAgdGhpcy54LmRvbWFpbihbZDMubWluKHNpbXVsYXRpb24uZGF0YSwgZCA9PiBkLmZyYW1lLnQpLCBkMy5tYXgoc2ltdWxhdGlvbi5kYXRhLCBkID0+IGQuZnJhbWUudCldKTtcbiAgICAgICAgaWYgKHRoaXMuY2hhcnQuaW5kZXBlbmRlbnRTY2FsZSkge1xuICAgICAgICAgICAgdGhpcy55LmRvbWFpbihbLXRoaXMubWF4QWJzWShzaW11bGF0aW9uLmRhdGEpLCB0aGlzLm1heEFic1koc2ltdWxhdGlvbi5kYXRhKV0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy55LmRvbWFpbihbZDMubWluKHRoaXMuY2hhcnQubGluZXMubWFwKGxpbmUgPT4gbGluZS5taW5ZKHNpbXVsYXRpb24uZGF0YSkpKSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIGQzLm1heCh0aGlzLmNoYXJ0LmxpbmVzLm1hcChsaW5lID0+IGxpbmUubWF4WShzaW11bGF0aW9uLmRhdGEpKSldKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLm5vZGUuYXR0cihcImRcIiwgdGhpcy5saW5lKHNpbXVsYXRpb24uZGF0YSkpO1xuICAgIH1cbn1cblxuY2xhc3MgVmFsdWVzQ2hhcnQgZXh0ZW5kcyBTaW11bGF0aW9uQ2hhcnQge1xuICAgIGNvbnN0cnVjdG9yIChvcHRpb25zKSB7XG4gICAgICAgIHN1cGVyKE9iamVjdC5hc3NpZ24oe30sIG9wdGlvbnMsIHtcbiAgICAgICAgICAgIGxpbmVzOiBbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBuYW1lOiAnemVybycsXG4gICAgICAgICAgICAgICAgICAgIHZhbHVlOiBkID0+IDAsXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiBcImdyZXlcIixcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogJ3NQJyxcbiAgICAgICAgICAgICAgICAgICAgdmFsdWU6IGQgPT4gZC5mcmFtZS5zUCxcbiAgICAgICAgICAgICAgICAgICAgY29sb3I6IFwic3RlZWxibHVlXCIsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIG5hbWU6ICdtZWFzdXJlZFBWJyxcbiAgICAgICAgICAgICAgICAgICAgdmFsdWU6IGQgPT4gZC5mcmFtZS5wVixcbiAgICAgICAgICAgICAgICAgICAgY29sb3I6IFwicGlua1wiLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBuYW1lOiAnYWN0dWFsUFYnLFxuICAgICAgICAgICAgICAgICAgICB2YWx1ZTogZCA9PiBkLnBWLFxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogXCJyZWRcIixcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogJ3BNYXgnLFxuICAgICAgICAgICAgICAgICAgICB2YWx1ZTogZCA9PiBkLnBNYXgsXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiBcImdyZWVuXCIsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIG5hbWU6ICdwTWluJyxcbiAgICAgICAgICAgICAgICAgICAgdmFsdWU6IGQgPT4gZC5wTWluLFxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogXCJncmVlblwiLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICB9KSk7XG4gICAgfVxufVxuXG5jbGFzcyBDb250cm9sQ2hhcnQgZXh0ZW5kcyBTaW11bGF0aW9uQ2hhcnQge1xuICAgIGNvbnN0cnVjdG9yIChvcHRpb25zKSB7XG4gICAgICAgIHN1cGVyKE9iamVjdC5hc3NpZ24oe30sIG9wdGlvbnMsIHtcbiAgICAgICAgICAgIGxpbmVzOiBbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBuYW1lOiAnemVybycsXG4gICAgICAgICAgICAgICAgICAgIHZhbHVlOiBkID0+IDAsXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiBcImdyZXlcIixcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogJ3RhcmdldENvbnRyb2wnLFxuICAgICAgICAgICAgICAgICAgICB2YWx1ZTogZCA9PiBkLmZyYW1lLmNvbnRyb2wsXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiBcInNreWJsdWVcIixcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogJ3Jlc3RyaWN0ZWRDb250cm9sJyxcbiAgICAgICAgICAgICAgICAgICAgdmFsdWU6IGQgPT4gZC5yZXN0cmljdGVkQ29udHJvbCxcbiAgICAgICAgICAgICAgICAgICAgY29sb3I6IFwic3RlZWxibHVlXCIsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIG5hbWU6ICdhY3R1YWxDb250cm9sJyxcbiAgICAgICAgICAgICAgICAgICAgdmFsdWU6IGQgPT4gZC5hY3R1YWxDb250cm9sLFxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogXCJtYWdlbnRhXCIsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIG5hbWU6ICdlZmZlY3RpdmVDb250cm9sJyxcbiAgICAgICAgICAgICAgICAgICAgdmFsdWU6IGQgPT4gZC5lZmZlY3RpdmVDb250cm9sLFxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogXCJncmVlblwiLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICB9KSk7XG4gICAgfVxufVxuXG5jbGFzcyBTdGF0ZUNoYXJ0IGV4dGVuZHMgU2ltdWxhdGlvbkNoYXJ0IHtcbiAgICBjb25zdHJ1Y3RvciAob3B0aW9ucykge1xuICAgICAgICBzdXBlcihPYmplY3QuYXNzaWduKHt9LCBvcHRpb25zLCB7XG4gICAgICAgICAgICBsaW5lczogW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogJ3plcm8nLFxuICAgICAgICAgICAgICAgICAgICB2YWx1ZTogZCA9PiAwLFxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogXCJncmV5XCIsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIG5hbWU6ICdlcnJvcicsXG4gICAgICAgICAgICAgICAgICAgIHZhbHVlOiBkID0+IGQuZnJhbWUuZXJyb3IsXG4gICAgICAgICAgICAgICAgICAgIGNvbG9yOiBcInJlZFwiLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBuYW1lOiAnc3VtRXJyb3InLFxuICAgICAgICAgICAgICAgICAgICB2YWx1ZTogZCA9PiBkLmZyYW1lLnN1bUVycm9yLFxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogXCJwdXJwbGVcIixcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogJ3JhdGVFcnJvcicsXG4gICAgICAgICAgICAgICAgICAgIHZhbHVlOiBkID0+IGQuZnJhbWUucmF0ZUVycm9yLFxuICAgICAgICAgICAgICAgICAgICBjb2xvcjogXCJwaW5rXCIsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgIH0pKTtcbiAgICB9XG59XG5cbmNsYXNzIFJlc3VsdHNEaXNwbGF5IHtcbiAgICBjb25zdHJ1Y3RvcigpIHtcbiAgICAgICAgbGV0IGNvbW1vbk9wdGlvbnMgPSB7XG4gICAgICAgICAgICBtb3VzZU92ZXI6ICgpID0+IHRoaXMuc2hvd1J1bGVyKCksXG4gICAgICAgICAgICBtb3VzZU1vdmU6IHQgPT4gdGhpcy51cGRhdGVSdWxlcih0KSxcbiAgICAgICAgICAgIG1vdXNlT3V0OiAoKSA9PiB0aGlzLmhpZGVSdWxlcigpLFxuICAgICAgICB9O1xuICAgICAgICB0aGlzLmRpc3BsYXlzID0gW1xuICAgICAgICAgIHRoaXMuc2ltdWxhdGlvblRhYmxlID0gbmV3IFNpbXVsYXRpb25UYWJsZShPYmplY3QuYXNzaWduKHt9LCBjb21tb25PcHRpb25zKSksXG4gICAgICAgICAgdGhpcy52YWx1ZXNDaGFydCA9IG5ldyBWYWx1ZXNDaGFydChPYmplY3QuYXNzaWduKHsgc2VsZWN0b3I6IFwiLnNpbS1jaGFydFwiLCB3aWR0aDogMTIwMCwgaGVpZ2h0OiAzMDAsIH0sIGNvbW1vbk9wdGlvbnMpKSxcbiAgICAgICAgICB0aGlzLmNvbnRyb2xDaGFydCA9IG5ldyBDb250cm9sQ2hhcnQoT2JqZWN0LmFzc2lnbih7IHNlbGVjdG9yOiBcIi5zaW0tY2hhcnRcIiwgd2lkdGg6IDEyMDAsIGhlaWdodDogMTUwLCBpbmRlcGVuZGVudFNjYWxlOiB0cnVlLCB9LCBjb21tb25PcHRpb25zKSksXG4gICAgICAgICAgdGhpcy5zdGF0ZUNoYXJ0ID0gbmV3IFN0YXRlQ2hhcnQoT2JqZWN0LmFzc2lnbih7IHNlbGVjdG9yOiBcIi5zaW0tY2hhcnRcIiwgd2lkdGg6IDEyMDAsIGhlaWdodDogMTUwLCBpbmRlcGVuZGVudFNjYWxlOiB0cnVlLCB9LCBjb21tb25PcHRpb25zKSksXG4gICAgICAgIF07XG4gICAgfVxuXG4gICAgdXBkYXRlIChzaW11bGF0aW9uKSB7XG4gICAgICAgIHRoaXMuZGlzcGxheXMuZm9yRWFjaChkID0+IGQudXBkYXRlKHNpbXVsYXRpb24pKTtcbiAgICB9XG5cbiAgICBzaG93UnVsZXIgKCkge1xuICAgICAgICB0aGlzLmRpc3BsYXlzLmZvckVhY2goZCA9PiBkLnNob3dSdWxlcigpKTtcbiAgICB9XG5cbiAgICBoaWRlUnVsZXIgKCkge1xuICAgICAgICB0aGlzLmRpc3BsYXlzLmZvckVhY2goZCA9PiBkLmhpZGVSdWxlcigpKTtcbiAgICB9XG5cbiAgICB1cGRhdGVSdWxlciAodCkge1xuICAgICAgICB0aGlzLmRpc3BsYXlzLmZvckVhY2goZCA9PiBkLnVwZGF0ZVJ1bGVyKHQpKTtcbiAgICB9XG59XG5cbmNsYXNzIEFwcCB7XG4gICAgY29uc3RydWN0b3IgKCkge1xuICAgICAgICB0aGlzLnBhcmFtZXRlcnNGb3JtID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcihcIi5wYXJhbWV0ZXJzIGZvcm1cIik7XG4gICAgICAgIHRoaXMuc2ltdWxhdGlvbiA9IG5ldyBTaW11bGF0aW9uKHRoaXMuc2ltdWxhdGlvbk9wdGlvbnMoKSk7XG4gICAgICAgIHRoaXMucmVzdWx0c0Rpc3BsYXkgPSBuZXcgUmVzdWx0c0Rpc3BsYXkoKTtcblxuICAgICAgICB0aGlzLnBhcmFtZXRlcnNGb3JtLmFkZEV2ZW50TGlzdGVuZXIoJ2NoYW5nZScsIGV2ZW50ID0+IHRoaXMudXBkYXRlKCkpO1xuICAgICAgICAvL3RoaXMucGFyYW1ldGVyc0Zvcm0ucXVlcnlTZWxlY3RvckFsbChcImlucHV0XCIpLmZvckVhY2gobm9kZSA9PiBub2RlLmFkZEV2ZW50TGlzdGVuZXIoJ2lucHV0JywgZSA9PiB0aGlzLnVwZGF0ZSgpKSk7XG4gICAgICAgIHRoaXMucGFyYW1ldGVyc0Zvcm0ucXVlcnlTZWxlY3RvckFsbChcImlucHV0XCIpLmZvckVhY2gobm9kZSA9PiBub2RlLmFkZEV2ZW50TGlzdGVuZXIoJ2tleXVwJywgZXZlbnQgPT4gdGhpcy5wYXJhbWV0ZXJLZXlMaXN0ZW5lcihldmVudCkpKTtcbiAgICB9XG5cbiAgICBwYXJhbWV0ZXJLZXlMaXN0ZW5lciAoZXZlbnQpIHtcbiAgICAgICAgaWYgKGV2ZW50LmlzQ29tcG9zaW5nIHx8IGV2ZW50LmtleUNvZGUgPT09IDIyOSkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIC8vY29uc29sZS5sb2coYGtleVVwICR7ZXZlbnQuY29kZX0gb24gJHtldmVudC50YXJnZXR9YCk7XG4gICAgICAgIGxldCB2YWwgPSBOdW1iZXIucGFyc2VGbG9hdChldmVudC50YXJnZXQudmFsdWUpO1xuICAgICAgICBpZiAoZXZlbnQuY29kZSA9PSAnQXJyb3dVcCcpIHtcbiAgICAgICAgICAgIGV2ZW50LnRhcmdldC52YWx1ZSA9IHZhbCArIHRoaXMuaW5jU3RlcCh2YWwpO1xuICAgICAgICB9IGVsc2UgaWYgKGV2ZW50LmNvZGUgPT0gJ0Fycm93RG93bicpIHtcbiAgICAgICAgICAgIGV2ZW50LnRhcmdldC52YWx1ZSA9IHZhbCAtIHRoaXMuZGVjU3RlcCh2YWwpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGxldCBjaGFuZ2VFdmVudCA9IG5ldyBFdmVudCgnY2hhbmdlJywgeyBidWJibGVzOiB0cnVlLCBjYW5jZWxsYWJsZTogZmFsc2UgfSk7XG4gICAgICAgIGV2ZW50LnRhcmdldC5kaXNwYXRjaEV2ZW50KGNoYW5nZUV2ZW50KTtcbiAgICB9XG5cbiAgICBuYW1lZElucHV0IChuYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnBhcmFtZXRlcnNGb3JtLnF1ZXJ5U2VsZWN0b3IoYGlucHV0W25hbWU9JyR7bmFtZX0nXWApO1xuICAgIH1cblxuICAgIG5hbWVkUGFyYW1ldGVyIChuYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLm5hbWVkSW5wdXQobmFtZSkudmFsdWU7XG4gICAgfVxuXG4gICAgZmxvYXRQYXJhbSAobmFtZSkge1xuICAgICAgICByZXR1cm4gTnVtYmVyLnBhcnNlRmxvYXQodGhpcy5uYW1lZFBhcmFtZXRlcihuYW1lKSk7XG4gICAgfVxuXG4gICAgaW5jU3RlcCAodmFsKSB7XG4gICAgICAgIC8vIGluY3JlbWVudCBpbiAxMHRocyBzdGVwcy5cbiAgICAgICAgcmV0dXJuIDEwICoqIChNYXRoLmZsb29yKE1hdGgubG9nMTAodmFsKSkgLSAxKTtcbiAgICB9XG5cbiAgICBkZWNTdGVwICh2YWwpIHtcbiAgICAgICAgLy8gZGVjcmVtZW50IG5lZWRzIHRvIHNlZSBpZiBpdCdzIHN0ZXBwaW5nIGRvd24gdG8gYSBzbWFsbGVyIHNjYWxlLlxuICAgICAgICBsZXQgYmlnID0gdGhpcy5pbmNTdGVwKHZhbCksIHNtYWxsID0gdGhpcy5pbmNTdGVwKHZhbCAtIGJpZyk7XG4gICAgICAgIHJldHVybiBNYXRoLm1pbihiaWcsIHNtYWxsKTtcbiAgICB9XG5cbiAgICBzaW11bGF0aW9uT3B0aW9ucyAoKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBpbml0aWFsUFY6IHRoaXMuZmxvYXRQYXJhbSgnaW5pdGlhbF9wdicpLFxuICAgICAgICAgICAgc1A6IHRoaXMuZmxvYXRQYXJhbSgnc3AnKSxcbiAgICAgICAgICAgIGtQOiB0aGlzLmZsb2F0UGFyYW0oJ2twJyksXG4gICAgICAgICAgICB0STogdGhpcy5mbG9hdFBhcmFtKCd0aScpLFxuICAgICAgICAgICAgdEQ6IHRoaXMuZmxvYXRQYXJhbSgndGQnKSxcbiAgICAgICAgICAgIGRUOiB0aGlzLmZsb2F0UGFyYW0oJ2R0JyksXG4gICAgICAgICAgICBzYXR1cmF0aW9uVXA6IHRoaXMuZmxvYXRQYXJhbSgnc2F0dXJhdGlvbl91cCcpLFxuICAgICAgICAgICAgc2F0dXJhdGlvbkRvd246IHRoaXMuZmxvYXRQYXJhbSgnc2F0dXJhdGlvbl9kb3duJyksXG4gICAgICAgICAgICBhY3R1YXRpb25GYWN0b3I6IHRoaXMuZmxvYXRQYXJhbSgnYWN0dWF0aW9uX2ZhY3RvcicpLFxuICAgICAgICAgICAgYXV0aG9yaXR5VXA6IHRoaXMuZmxvYXRQYXJhbSgnYXV0aG9yaXR5X3VwJyksXG4gICAgICAgICAgICBhdXRob3JpdHlEb3duOiB0aGlzLmZsb2F0UGFyYW0oJ2F1dGhvcml0eV9kb3duJyksXG4gICAgICAgICAgICBtZWFzdXJlbWVudE5vaXNlOiB0aGlzLmZsb2F0UGFyYW0oJ21lYXN1cmVtZW50X25vaXNlJyksXG4gICAgICAgICAgICBkdXJhdGlvbjogdGhpcy5mbG9hdFBhcmFtKCdkdXJhdGlvbicpLFxuICAgICAgICAgICAgZHJpZnQ6IHRoaXMuZmxvYXRQYXJhbSgnZHJpZnQnKSxcbiAgICAgICAgICAgIHNldFBvaW50czogdGhpcy5uYW1lZFBhcmFtZXRlcignc2V0X3BvaW50cycpLFxuXG4gICAgICAgICAgICBkZWNheWluZ0ludGVncmFsOiB0aGlzLm5hbWVkSW5wdXQoJ2RlY2F5aW5nX2ludGVncmFsJykuY2hlY2tlZCxcbiAgICAgICAgICAgIGRlY2F5UmF0ZTogdGhpcy5mbG9hdFBhcmFtKCdkZWNheV9yYXRlJyksXG4gICAgICAgICAgICBkZWNheVRocmVzaG9sZDogdGhpcy5mbG9hdFBhcmFtKCdkZWNheV90aHJlc2hvbGQnKSxcblxuICAgICAgICAgICAgYXN5bW1ldHJpY0ludGVncmFsOiB0aGlzLm5hbWVkSW5wdXQoJ2FzeW1tZXRyaWNfaW50ZWdyYWwnKS5jaGVja2VkLFxuICAgICAgICAgICAgZGl2ZXJnaW5nUmF0ZTogdGhpcy5mbG9hdFBhcmFtKCdkaXZlcmdpbmdfcmF0ZScpLFxuICAgICAgICAgICAgY29udmVyZ2luZ1JhdGU6IHRoaXMuZmxvYXRQYXJhbSgnY29udmVyZ2luZ19yYXRlJyksXG5cbiAgICAgICAgICAgIHBMaW1pdEludGVncmFsOiB0aGlzLm5hbWVkSW5wdXQoJ3BsaW1pdF9pbnRlZ3JhbCcpLmNoZWNrZWQsXG5cbiAgICAgICAgICAgIHJhdGVFcnJvcklnbm9yZXNTUENoYW5nZTogdGhpcy5uYW1lZElucHV0KCdyYXRlX2Vycm9yX2lnbm9yZXNfc3BfY2hhbmdlJykuY2hlY2tlZCxcblxuICAgICAgICAgICAgc21vb3RoZWRQVjogdGhpcy5uYW1lZElucHV0KCdzbW9vdGhlZF9wdicpLmNoZWNrZWQsXG4gICAgICAgICAgICBzbW9vdGhlZFBWRmFjdG9yOiB0aGlzLmZsb2F0UGFyYW0oJ3Ntb290aGVkX3B2X2ZhY3RvcicpLFxuXG4gICAgICAgICAgICBzbW9vdGhlZFNQOiB0aGlzLm5hbWVkSW5wdXQoJ3Ntb290aGVkX3NwJykuY2hlY2tlZCxcbiAgICAgICAgICAgIHNtb290aGVkU1BGYWN0b3I6IHRoaXMuZmxvYXRQYXJhbSgnc21vb3RoZWRfc3BfZmFjdG9yJyksXG5cbiAgICAgICAgICAgIHNtb290aGVkUmF0ZUVycm9yOiB0aGlzLm5hbWVkSW5wdXQoJ3Ntb290aGVkX3JhdGVfZXJyb3InKS5jaGVja2VkLFxuICAgICAgICAgICAgc21vb3RoZWRSYXRlRXJyb3JGYWN0b3I6IHRoaXMuZmxvYXRQYXJhbSgnc21vb3RoZWRfcmF0ZV9lcnJvcl9mYWN0b3InKSxcblxuICAgICAgICAgICAgc21vb3RoZWRFcnJvcjogdGhpcy5uYW1lZElucHV0KCdzbW9vdGhlZF9lcnJvcicpLmNoZWNrZWQsXG4gICAgICAgICAgICBzbW9vdGhlZEVycm9yRmFjdG9yOiB0aGlzLmZsb2F0UGFyYW0oJ3Ntb290aGVkX2Vycm9yX2ZhY3RvcicpLFxuXG4gICAgICAgICAgICBzbW9vdGhlZFN1bUVycm9yOiB0aGlzLm5hbWVkSW5wdXQoJ3Ntb290aGVkX3N1bV9lcnJvcicpLmNoZWNrZWQsXG4gICAgICAgICAgICBzbW9vdGhlZFN1bUVycm9yRmFjdG9yOiB0aGlzLmZsb2F0UGFyYW0oJ3Ntb290aGVkX3N1bV9lcnJvcl9mYWN0b3InKSxcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICB1cGRhdGUgKCkge1xuICAgICAgICBjb25zb2xlLmxvZyhcIlVwZGF0aW5nIHNpbXVsYXRpb24uXCIpO1xuICAgICAgICB0aGlzLnNpbXVsYXRpb24uY29uZmlndXJlKHRoaXMuc2ltdWxhdGlvbk9wdGlvbnMoKSk7XG4gICAgICAgIHRoaXMuc2ltdWxhdGlvbi5yZXNldCgpO1xuICAgICAgICB0aGlzLnJ1bigpO1xuICAgIH1cblxuICAgIHJ1biAoKSB7XG4gICAgICAgIHRoaXMuc2ltdWxhdGlvbi5ydW4oKTtcbiAgICAgICAgdGhpcy5yZXN1bHRzRGlzcGxheS51cGRhdGUodGhpcy5zaW11bGF0aW9uKTtcbiAgICB9XG59XG5cblxubGV0IGFwcCA9IG5ldyBBcHAoKTtcbndpbmRvdy5hcHAgPSBhcHA7XG5cbmFwcC5ydW4oKTtcblxufSkoZG9jdW1lbnQsIHdpbmRvdyk7XG4iLCIvKiBqc2hpbnQgZXN2ZXJzaW9uOiA5LCBub2RlOiB0cnVlICovXG5cInVzZSBzdHJpY3RcIjtcblxuY2xhc3MgQXN5bW1ldHJpY0ludGVncmFsIHtcbiAgICBzdGF0aWMgRElWRVJHSU5HX1JBVEUgID0gMTtcbiAgICBzdGF0aWMgQ09OVkVSR0lOR19SQVRFID0gNTtcblxuICAgIGNvbnN0cnVjdG9yIChvcHRpb25zID0ge30pIHtcbiAgICAgICAgdGhpcy5kaXZlcmdpbmdSYXRlICA9IG9wdGlvbnMuZGl2ZXJnaW5nUmF0ZSAgPz8gdGhpcy5jb25zdHJ1Y3Rvci5ERUZBVUxUX0RJVkVSR0lOR19SQVRFO1xuICAgICAgICB0aGlzLmNvbnZlcmdpbmdSYXRlID0gb3B0aW9ucy5jb252ZXJnaW5nUmF0ZSA/PyB0aGlzLmNvbnN0cnVjdG9yLkRFRkFVTFRfQ09OVkVSR0lOR19SQVRFO1xuICAgIH1cblxuICAgIHN1bUVycm9yICh2YWx1ZSwgcGlkLCBmcmFtZSwgbGFzdEZyYW1lLCBkVCkge1xuICAgICAgICBsZXQgbGFzdFN1bUVycm9yID0gbGFzdEZyYW1lLnN1bUVycm9yO1xuICAgICAgICBsZXQgZGVsdGEgPSBmcmFtZS5lcnJvciAqIGRUO1xuICAgICAgICBsZXQgb3JpZ2luYWxEZWx0YSA9IGRlbHRhO1xuXG4gICAgICAgIGlmIChmcmFtZS5lcnJvckluY3JlYXNpbmcoKSkge1xuICAgICAgICAgICAgZGVsdGEgKj0gdGhpcy5kaXZlcmdpbmdSYXRlO1xuICAgICAgICB9IGVsc2UgaWYgKGZyYW1lLmVycm9yRGVjcmVhc2luZygpKSB7XG4gICAgICAgICAgICBkZWx0YSAqPSB0aGlzLmNvbnZlcmdpbmdSYXRlO1xuICAgICAgICAgICAgaWYgKE1hdGguYWJzKGRlbHRhKSA+IE1hdGguYWJzKGxhc3RTdW1FcnJvcikpIHtcbiAgICAgICAgICAgICAgICAvLyBFbnN1cmUgd2UgZG9uJ3Qgb3ZlcnNob290IGFjcm9zcyB6ZXJvLlxuLy8gICAgICAgICAgICAgICAgcmV0dXJuIDA7XG4gICAgICAgICAgICAgICAgZGVsdGEgPSBvcmlnaW5hbERlbHRhO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGxhc3RTdW1FcnJvciArIGRlbHRhO1xuICAgIH1cbn1cblxuZXhwb3J0cy5Bc3ltbWV0cmljSW50ZWdyYWwgPSBBc3ltbWV0cmljSW50ZWdyYWw7XG4iLCIvKiBqc2hpbnQgZXN2ZXJzaW9uOiA5LCBub2RlOiB0cnVlICovXG5cInVzZSBzdHJpY3RcIjtcblxuY2xhc3MgQmFzaWMge1xuICAgIGNvbnN0cnVjdG9yICgpIHtcbiAgICB9XG5cbiAgICBlcnJvciAodmFsdWUsIHBpZCwgZnJhbWUsIGxhc3RGcmFtZSwgZFQpIHtcbiAgICAgICAgcmV0dXJuIGZyYW1lLnNQIC0gZnJhbWUucFY7XG4gICAgfVxuXG4gICAgcmF0ZUVycm9yICh2YWx1ZSwgcGlkLCBmcmFtZSwgbGFzdEZyYW1lLCBkVCkge1xuICAgICAgICByZXR1cm4gKGZyYW1lLmVycm9yIC0gbGFzdEZyYW1lLmVycm9yKSAvIGRUO1xuICAgIH1cblxuICAgIHN1bUVycm9yICh2YWx1ZSwgcGlkLCBmcmFtZSwgbGFzdEZyYW1lLCBkVCkge1xuICAgICAgICByZXR1cm4gbGFzdEZyYW1lLnN1bUVycm9yICsgZnJhbWUuZXJyb3IgKiBkVDtcbiAgICB9XG59XG5cbmV4cG9ydHMuQmFzaWMgPSBCYXNpYztcbiIsIi8qIGpzaGludCBlc3ZlcnNpb246IDksIG5vZGU6IHRydWUgKi9cblwidXNlIHN0cmljdFwiO1xuXG5jbGFzcyBEZWNheWluZ0ludGVncmFsIHtcbiAgICBzdGF0aWMgREVGQVVMVF9ERUNBWV9SQVRFID0gMC45NTtcbiAgICBzdGF0aWMgREVGQVVMVF9USFJFU0hPTEQgID0gMjA7XG5cbiAgICBjb25zdHJ1Y3RvciAob3B0aW9ucyA9IHt9KSB7XG4gICAgICAgIHRoaXMuZGVjYXlSYXRlID0gb3B0aW9ucy5kZWNheVJhdGUgPz8gdGhpcy5jb25zdHJ1Y3Rvci5ERUZBVUxUX0RFQ0FZX1JBVEU7XG4gICAgICAgIHRoaXMudGhyZXNob2xkID0gb3B0aW9ucy50aHJlc2hvbGQgPz8gdGhpcy5jb25zdHJ1Y3Rvci5ERUZBVUxUX1RIUkVTSE9MRDtcbiAgICB9XG5cbiAgICBvdmVyVGhyZXNob2xkICh2YWx1ZSwgcGlkLCBmcmFtZSwgbGFzdEZyYW1lLCBkVCkge1xuICAgICAgICBsZXQgbGFzdFN1bUVycm9yID0gbGFzdEZyYW1lLnN1bUVycm9yO1xuXG4gICAgICAgIHJldHVybiBNYXRoLmFicyhsYXN0U3VtRXJyb3IpID49IE1hdGguYWJzKGZyYW1lLmVycm9yICogdGhpcy50aHJlc2hvbGQpO1xuICAgIH1cblxuICAgIHNob3VsZERlY2F5ICh2YWx1ZSwgcGlkLCBmcmFtZSwgbGFzdEZyYW1lLCBkVCkge1xuICAgICAgICByZXR1cm4gbGFzdEZyYW1lLndpbmRpbmdVcCgpICYmXG4gICAgICAgICAgICB0aGlzLm92ZXJUaHJlc2hvbGQodmFsdWUsIHBpZCwgZnJhbWUsIGxhc3RGcmFtZSwgZFQpO1xuICAgIH1cblxuICAgIHN1bUVycm9yICh2YWx1ZSwgcGlkLCBmcmFtZSwgbGFzdEZyYW1lLCBkVCkge1xuICAgICAgICBsZXQgbGFzdFN1bUVycm9yID0gbGFzdEZyYW1lLnN1bUVycm9yO1xuXG4gICAgICAgIGZyYW1lLmRlY2F5aW5nSW50ZWdyYWxBY3RpdmUgPSB0aGlzLnNob3VsZERlY2F5KHZhbHVlLCBwaWQsIGZyYW1lLCBsYXN0RnJhbWUsIGRUKTtcbiAgICAgICAgaWYgKGZyYW1lLmRlY2F5aW5nSW50ZWdyYWxBY3RpdmUpIHtcbiAgICAgICAgICAgIGxhc3RTdW1FcnJvciA9IGxhc3RTdW1FcnJvciAqICh0aGlzLmRlY2F5UmF0ZSAqKiBkVCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGxhc3RTdW1FcnJvciArIChmcmFtZS5lcnJvciAqIGRUKTtcbiAgICB9XG59XG5cbmV4cG9ydHMuRGVjYXlpbmdJbnRlZ3JhbCA9IERlY2F5aW5nSW50ZWdyYWw7XG4iLCIvKiBqc2hpbnQgZXN2ZXJzaW9uOiA5LCBub2RlOiB0cnVlICovXG5cInVzZSBzdHJpY3RcIjtcblxuLy8gRnJlZXplcyB0aGUgaW50ZWdyYWwgaWYgdGhlIGVycm9yIHBhc3NlcyBvdXRzaWRlIHRoZSBsaW1pdCBvZiBwcm9wb3J0aW9uYWwgY29udHJvbC5cbi8vIFlvdSBwcm9iYWJseSBhbHdheXMgd2FudCB0aGlzIHRvIGJlIGxhc3Qgb2YgYW55IGludGVncmFsIGJlaGF2aW91cnMuXG5jbGFzcyBQTGltaXRJbnRlZ3JhbCB7XG4gICAgY29uc3RydWN0b3IgKG9wdGlvbnMgPSB7fSkge1xuICAgIH1cblxuICAgIHN1bUVycm9yICh2YWx1ZSwgcGlkLCBmcmFtZSwgbGFzdEZyYW1lLCBkVCkge1xuICAgICAgICBjb25zdCBsYXN0U3VtRXJyb3IgPSBsYXN0RnJhbWUuc3VtRXJyb3I7XG4gICAgICAgIGNvbnN0IHdpdGhpblBMaW1pdCA9IE1hdGguYWJzKHBpZC5wTGltaXQoKSkgPj0gTWF0aC5hYnMoZnJhbWUuZXJyb3IpO1xuXG4gICAgICAgIGlmICh3aXRoaW5QTGltaXQpIHtcbiAgICAgICAgICAgIHJldHVybiB2YWx1ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBsYXN0U3VtRXJyb3I7XG4gICAgfVxufVxuXG5leHBvcnRzLlBMaW1pdEludGVncmFsID0gUExpbWl0SW50ZWdyYWw7XG4iLCIvKiBqc2hpbnQgZXN2ZXJzaW9uOiA5LCBub2RlOiB0cnVlICovXG5cInVzZSBzdHJpY3RcIjtcblxuLy8gSWdub3JlIGNoYW5nZSBpbiBlcnJvciBjYXVzZWQgYnkgU1AgY2hhbmdlLlxuY2xhc3MgUmF0ZUVycm9ySWdub3Jlc1NQQ2hhbmdlIHtcbiAgICBjb25zdHJ1Y3RvciAob3B0aW9ucyA9IHt9KSB7XG4gICAgfVxuXG4gICAgcmF0ZUVycm9yICh2YWx1ZSwgcGlkLCBmcmFtZSwgbGFzdEZyYW1lLCBkVCkge1xuICAgICAgICBjb25zdCByYXRlU1AgPSAoZnJhbWUuc1AgLSBsYXN0RnJhbWUuc1ApIC8gZFQ7XG5cbiAgICAgICAgcmV0dXJuIHZhbHVlIC0gcmF0ZVNQO1xuICAgIH1cbn1cblxuZXhwb3J0cy5SYXRlRXJyb3JJZ25vcmVzU1BDaGFuZ2UgPSBSYXRlRXJyb3JJZ25vcmVzU1BDaGFuZ2U7XG4iLCIvKiBqc2hpbnQgZXN2ZXJzaW9uOiA5LCBub2RlOiB0cnVlICovXG5cInVzZSBzdHJpY3RcIjtcblxuY2xhc3MgU21vb3RoVmFsdWUge1xuICAgIHN0YXRpYyBERUZBVUxUX1NNT09USF9GQUNUT1IgPSAwLjU7XG5cbiAgICBjb25zdHJ1Y3RvciAob3B0aW9ucyA9IHt9KSB7XG4gICAgICAgIHRoaXMuc21vb3RoRmFjdG9yID0gb3B0aW9ucy5zbW9vdGhGYWN0b3IgPz8gdGhpcy5jb25zdHJ1Y3Rvci5ERUZBVUxUX1NNT09USF9GQUNUT1I7XG4gICAgICAgIHRoaXMuc21vb3RoRmFjdG9yID0gTWF0aC5tYXgoTWF0aC5taW4odGhpcy5zbW9vdGhGYWN0b3IsIDEuMCksIDAuMCk7XG4gICAgICAgIHRoaXMudmFsdWUgPSBvcHRpb25zLnZhbHVlO1xuICAgICAgICB0aGlzW3RoaXMudmFsdWVdID0gdGhpcy5zbW9vdGhWYWx1ZTtcbiAgICB9XG5cbiAgICBzbW9vdGhWYWx1ZSh2YWx1ZSwgcGlkLCBmcmFtZSwgbGFzdEZyYW1lLCBkVCkge1xuICAgICAgICBmcmFtZVsncHJlU21vb3RoJyArIHRoaXMudmFsdWUuc2xpY2UoMCwgMSkudG9VcHBlckNhc2UoKSArIHRoaXMudmFsdWUuc2xpY2UoMSldID0gdmFsdWU7XG4gICAgICAgIGlmIChsYXN0RnJhbWUpIHtcbiAgICAgICAgICAgIHJldHVybiB2YWx1ZSAqICgxLjAgLSB0aGlzLnNtb290aEZhY3RvcikgKyBsYXN0RnJhbWVbdGhpcy52YWx1ZV0gKiB0aGlzLnNtb290aEZhY3RvcjtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiB2YWx1ZTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZXhwb3J0cy5TbW9vdGhWYWx1ZSA9IFNtb290aFZhbHVlO1xuIiwiLyoganNoaW50IGVzdmVyc2lvbjogOSwgbm9kZTogdHJ1ZSAqL1xuXCJ1c2Ugc3RyaWN0XCI7XG5cbmNvbnN0IHBlcmZvcm1hbmNlID0gd2luZG93Py5wZXJmb3JtYW5jZSA/PyByZXF1aXJlKCdwZXJmX2hvb2tzJykucGVyZm9ybWFuY2U7XG5jb25zdCB7IEJhc2ljIH0gPSByZXF1aXJlKCcuL2JlaGF2aW91cnMvYmFzaWMnKTtcblxuY2xhc3MgUElEIHtcbiAgICBzdGF0aWMgREVGQVVMVF9LUCA9IDE7XG4gICAgc3RhdGljIERFRkFVTFRfVEkgPSAxO1xuICAgIHN0YXRpYyBERUZBVUxUX1REID0gMTtcbiAgICBzdGF0aWMgREVGQVVMVF9TUCA9IDA7XG5cbiAgICBzdGF0aWMgREVGQVVMVF9NQVhfVVBEQVRFX0ZSQU1FUyA9IDU7XG4gICAgc3RhdGljIERFRkFVTFRfTUlOX1VQREFURV9USU1FID0gMC4wMDAwMDAxO1xuXG4gICAgc3RhdGljIERFRkFVTFRfQkVIQVZJT1VSUyA9IFtuZXcgQmFzaWMoKV07XG5cbiAgICBzdGF0aWMgQkVIQVZJT1VSX01FVEhPRFMgPSBbXG4gICAgICAgICdzUCcsXG4gICAgICAgICdwVicsXG4gICAgICAgICdlcnJvcicsXG4gICAgICAgICdyYXRlRXJyb3InLFxuICAgICAgICAnc3VtRXJyb3InLFxuICAgIF07XG5cbiAgICBjb25zdHJ1Y3RvciAob3B0aW9ucyA9IHt9KSB7XG4gICAgICAgIHRoaXMua1AgPSBvcHRpb25zLmtQID8/IHRoaXMuY29uc3RydWN0b3IuREVGQVVMVF9LUDtcbiAgICAgICAgdGhpcy5rSSA9IG9wdGlvbnMua0kgPz8gKHRoaXMua1AgLyAob3B0aW9ucy50SSA/PyB0aGlzLmNvbnN0cnVjdG9yLkRFRkFVTFRfVEkpKTtcbiAgICAgICAgdGhpcy5rRCA9IG9wdGlvbnMua0QgPz8gKHRoaXMua1AgLyAob3B0aW9ucy50RCA/PyB0aGlzLmNvbnN0cnVjdG9yLkRFRkFVTFRfVEQpKTtcbiAgICAgICAgdGhpcy5tYXhfdXBkYXRlX2ZyYW1lcyA9IG9wdGlvbnMubWF4X3VwZGF0ZV9mcmFtZXMgPz8gdGhpcy5jb25zdHJ1Y3Rvci5ERUZBVUxUX01BWF9VUERBVEVfRlJBTUVTO1xuICAgICAgICB0aGlzLm1pbl91cGRhdGVfdGltZSA9IG9wdGlvbnMubWluX3VwZGF0ZV90aW1lID8/IHRoaXMuY29uc3RydWN0b3IuREVGQVVMVF9NSU5fVVBEQVRFX1RJTUU7XG4gICAgICAgIC8vIEdyb3VwIHN1cHBsaWVkIGJlaGF2aW91cnMgYnkgdGhlIG1ldGhvZHMgdGhleSBtb2RpZnkuXG4gICAgICAgIHRoaXMuYmVoYXZpb3VycyA9IE9iamVjdC5mcm9tRW50cmllcyh0aGlzLmNvbnN0cnVjdG9yLkJFSEFWSU9VUl9NRVRIT0RTLm1hcChrID0+IFtrLCBbXV0pKTtcbiAgICAgICAgKG9wdGlvbnMuYmVoYXZpb3VycyA/PyB0aGlzLmNvbnN0cnVjdG9yLkRFRkFVTFRfQkVIQVZJT1VSUykuZm9yRWFjaChiZWhhdmlvdXIgPT4ge1xuICAgICAgICAgICAgdGhpcy5jb25zdHJ1Y3Rvci5CRUhBVklPVVJfTUVUSE9EUy5mb3JFYWNoKG1ldGhvZCA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKGJlaGF2aW91clttZXRob2RdKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuYmVoYXZpb3Vyc1ttZXRob2RdLnB1c2goYmVoYXZpb3VyKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICAgIHRoaXMucmVzZXQob3B0aW9ucy50ID8/IG51bGwpO1xuICAgIH1cblxuICAgIC8vIEVycm9yIGxpbWl0IG9mIHByb3BvcnRpb25hbCBjb250cm9sLlxuICAgIHBMaW1pdCAoKSB7XG4gICAgICAgIHJldHVybiAxIC8gdGhpcy5rUDtcbiAgICB9XG5cbiAgICAvLyBVcHBlciBsaW1pdCBvZiBwcm9wb3J0aW9uYWwgY29udHJvbFxuICAgIHBNYXggKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5zUCArIHRoaXMucExpbWl0KCk7XG4gICAgfVxuXG4gICAgLy8gTG93ZXIgbGltaXQgb2YgcHJvcG9ydGlvbmFsIGNvbnRyb2xcbiAgICBwTWluICgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc1AgLSB0aGlzLnBMaW1pdCgpO1xuICAgIH1cblxuICAgIHJlc2V0ICh0ID0gbnVsbCkge1xuICAgICAgICB0aGlzLnNQID0gdGhpcy5jb25zdHJ1Y3Rvci5ERUZBVUxUX1NQO1xuICAgICAgICAvLyBUT0RPOiBiYWQgYXNzdW1wdGlvbiB0byBhc3N1bWUgcFYgaXMgY29ycmVjdD9cbiAgICAgICAgbGV0IGZyYW1lID0gbmV3IFBJREZyYW1lKHRoaXMuc1AsIHRoaXMuc1AsIHQpO1xuICAgICAgICBmcmFtZS5lcnJvciA9IDA7XG4gICAgICAgIGZyYW1lLnN1bUVycm9yID0gMDtcbiAgICAgICAgZnJhbWUucmF0ZUVycm9yID0gMDtcbiAgICAgICAgZnJhbWUuY29udHJvbCA9IDA7XG4gICAgICAgIHRoaXMudXBkYXRlRnJhbWVzID0gW2ZyYW1lXTtcbiAgICB9XG5cbiAgICB1cGRhdGUgKHBWLCB0ID0gbnVsbCkge1xuICAgICAgICBsZXQgZnJhbWUgPSBuZXcgUElERnJhbWUodGhpcy5zUCwgcFYsIHQpO1xuICAgICAgICBsZXQgbGFzdEZyYW1lID0gdGhpcy51cGRhdGVGcmFtZXNbMF07XG4gICAgICAgIGxldCBkVCA9IGZyYW1lLnQgLSBsYXN0RnJhbWUudDtcblxuICAgICAgICBpZiAoZFQgPCB0aGlzLm1pbl91cGRhdGVfdGltZSkge1xuICAgICAgICAgICAgLy8gVXBkYXRlIGlzIHRvbyBzb29uIGFmdGVyIHByZXZpb3VzLlxuICAgICAgICAgICAgLy8gVE9ETzogaXNzdWUgd2FybmluZ1xuICAgICAgICAgICAgcmV0dXJuIGxhc3RGcmFtZS5jb250cm9sO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRoaXMudXBkYXRlRnJhbWUoZnJhbWUsIGxhc3RGcmFtZSwgZFQpKSB7XG4gICAgICAgICAgICB0aGlzLnN0b3JlRnJhbWUoZnJhbWUpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gVE9ETzogYWJzdHJhY3Rpb24gbGF5ZXI/XG4gICAgICAgIHJldHVybiB0aGlzLnVwZGF0ZUZyYW1lc1swXS5jb250cm9sO1xuICAgIH1cblxuICAgIHVwZGF0ZUZyYW1lIChmcmFtZSwgbGFzdEZyYW1lLCBkVCkge1xuICAgICAgICBmcmFtZS5zUCA9IHRoaXMuYmVoYXZpb3VyUmVkdWNlKCdzUCcsIGZyYW1lLnNQLCBmcmFtZSwgbGFzdEZyYW1lLCBkVCk7XG4gICAgICAgIGZyYW1lLnBWID0gdGhpcy5iZWhhdmlvdXJSZWR1Y2UoJ3BWJywgZnJhbWUucFYsIGZyYW1lLCBsYXN0RnJhbWUsIGRUKTtcbiAgICAgICAgZnJhbWUuZXJyb3IgPSB0aGlzLmJlaGF2aW91clJlZHVjZSgnZXJyb3InLCAwLCBmcmFtZSwgbGFzdEZyYW1lLCBkVCk7XG4gICAgICAgIGZyYW1lLnJhdGVFcnJvciA9IHRoaXMuYmVoYXZpb3VyUmVkdWNlKCdyYXRlRXJyb3InLCAwLCBmcmFtZSwgbGFzdEZyYW1lLCBkVCk7XG4gICAgICAgIGZyYW1lLnN1bUVycm9yID0gdGhpcy5iZWhhdmlvdXJSZWR1Y2UoJ3N1bUVycm9yJywgMCwgZnJhbWUsIGxhc3RGcmFtZSwgZFQpO1xuXG4gICAgICAgIGZyYW1lLmNvbnRyb2wgPSAoZnJhbWUuZXJyb3IgKiB0aGlzLmtQKSArIChmcmFtZS5zdW1FcnJvciAqIHRoaXMua0kpICsgKGZyYW1lLnJhdGVFcnJvciAqIHRoaXMua0QpO1xuXG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIGJlaGF2aW91clJlZHVjZSAobWV0aG9kLCB2YWx1ZSwgZnJhbWUsIGxhc3RGcmFtZSwgZFQpIHtcbiAgICAgICAgdGhpcy5iZWhhdmlvdXJzW21ldGhvZF0uZm9yRWFjaChiZWhhdmlvdXIgPT4ge1xuICAgICAgICAgICAgdmFsdWUgPSBiZWhhdmlvdXJbbWV0aG9kXSh2YWx1ZSwgdGhpcywgZnJhbWUsIGxhc3RGcmFtZSwgZFQpO1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cblxuICAgIHN0b3JlRnJhbWUgKGZyYW1lKSB7XG4gICAgICAgIHRoaXMudXBkYXRlRnJhbWVzLnVuc2hpZnQoZnJhbWUpO1xuICAgICAgICBpZiAodGhpcy5tYXhfdXBkYXRlX2ZyYW1lcyA+PSAxKSB7XG4gICAgICAgICAgICB3aGlsZSAodGhpcy51cGRhdGVGcmFtZXMubGVuZ3RoID4gdGhpcy5tYXhfdXBkYXRlX2ZyYW1lcykge1xuICAgICAgICAgICAgICAgIHRoaXMudXBkYXRlRnJhbWVzLnBvcCgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxufVxuXG5jbGFzcyBQSURGcmFtZSB7XG4gICAgY29uc3RydWN0b3IgKHNQLCBwViwgdCkge1xuICAgICAgICB0aGlzLnNQID0gc1A7XG4gICAgICAgIHRoaXMucFYgPSBwVjtcbiAgICAgICAgdGhpcy50ID0gdCA/PyBwZXJmb3JtYW5jZS5ub3coKTtcbiAgICAgICAgdGhpcy5lcnJvciA9IG51bGw7XG4gICAgICAgIHRoaXMuc3VtRXJyb3IgPSBudWxsO1xuICAgICAgICB0aGlzLnJhdGVFcnJvciA9IG51bGw7XG4gICAgICAgIHRoaXMuY29udHJvbCA9IG51bGw7XG4gICAgfVxuXG4gICAgd2luZGluZ1VwICgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3VtRXJyb3IgKiB0aGlzLnJhdGVFcnJvciA+IDA7XG4gICAgfVxuXG4gICAgd2luZGluZ0Rvd24gKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5zdW1FcnJvciAqIHRoaXMucmF0ZUVycm9yIDwgMDtcbiAgICB9XG5cbiAgICBlcnJvckluY3JlYXNpbmcgKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5lcnJvciAqIHRoaXMucmF0ZUVycm9yIDwgMDtcbiAgICB9XG5cbiAgICBlcnJvckRlY3JlYXNpbmcgKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5lcnJvciAqIHRoaXMucmF0ZUVycm9yID4gMDtcbiAgICB9XG59XG5cbmV4cG9ydHMuUElEID0gUElEO1xuIiwiIl19
