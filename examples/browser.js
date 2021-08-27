/* jshint esversion: 9, node: true */
"use strict";

(function (document, window, undefined) {

const { PID } = require('../lib/pid');
const { Basic } = require('../lib/behaviours/basic');
const { DecayingIntegral } = require('../lib/behaviours/decaying-integral');
const { AsymmetricIntegral } = require('../lib/behaviours/asymmetric-integral');
const { PLimitIntegral } = require('../lib/behaviours/plimit-integral');

class Simulation {
    constructor (options) {
        this.configure(options);
        this.reset();
    }

    configure (options) {
        this.sP = options.sP;
        this.pV = options.initialPV;
        this.measurementNoise = options.measurementNoise;
        this.control = 0;
        this.restrictedControl = 0;
        this.effectiveControl = 0;
        this.dT = options.dT;
        this.authority = [options.authorityDown, options.authorityUp];
        this.saturation = [options.saturationDown, options.saturationUp];
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

        this.pid = new PID({
          t: 0,
          kP: options.kP,
          tI: options.tI,
          tD: options.tD,
          behaviours: behaviours,
        });
    }

    reset () {
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
        return (Math.random() + Math.random()) * 0.5;
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
            this.effectiveControl = this.restrictedControl * this.authority[0];
        } else {
            if (this.saturation[1] !== null && this.restrictedControl > this.saturation[1]) {
                this.restrictedControl = this.saturation[1];
            }
            this.effectiveControl = this.restrictedControl * this.authority[1];
        }

        let frame = this.pid.updateFrames[0];

        this.data.push({
            frame: frame,
            pV: this.pV, // actual pV
            restrictedControl: this.restrictedControl,
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
            <th>effectiveControl</th>
        </tr>`);

        this.node = table.append("tbody");
    }

    update (simulation) {
        const dataRow = (d) => {
            return `
                <td>${d.frame.t}</td>
                <td>${d.frame.sP}</td>
                <td>${d.frame.pV}</td>
                <td>${d.frame.error}</td>
                <td>${d.frame.sumError}</td>
                <td>${d.frame.rateError}</td>
                <td>${d.frame.control}</td>
                <td>${d.restrictedControl}</td>
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
                    name: 'control',
                    value: d => d.frame.control,
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
            authorityUp: this.floatParam('authority_up'),
            authorityDown: this.floatParam('authority_down'),
            saturationUp: this.floatParam('saturation_up'),
            saturationDown: this.floatParam('saturation_down'),
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
