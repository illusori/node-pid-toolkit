/* jshint esversion: 9, node: true */
"use strict";

(function (document, window, undefined) {

const { PID } = require('../lib/pid');

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

        this.pid = new PID({
          t: 0,
          kP: options.kP,
          tI: options.tI,
          tD: options.tD,
        });
    }

    reset () {
        this.t = 0;
        this.data = [];
        this.pid.reset(this.t);
        this.pid.sP = this.sP;
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
        });
    }

    run () {
        for (let i = 0; i < 60; i += this.dT) {
            this.update(this.dT);
        }
    }
}

class SimulationTable {
    constructor () {
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
    }
}

class SimulationChart {
    constructor (options = {}) {
        this.selector = options.selector;
        this.width = options.width;
        this.height = options.height;
        this.independentScale = options.independentScale;

        const chart = d3.select(this.selector).append("svg")
        this.node = chart;

        chart.attr("width", this.width)
            .attr("height", this.height);

        this.margin = { top: 10, right: 20, bottom: 20, left: 30 };

        this.lines = [];
        options.lines.forEach(line => {
            let lineOptions = Object.assign({}, line);
            lineOptions.chart = this;
            lineOptions.x = d3.scaleLinear().range([this.margin.left, this.width - this.margin.right]);
            lineOptions.y = d3.scaleLinear().range([this.height - this.margin.bottom, this.margin.top]);
            this.xScale = this.xScale ?? lineOptions.x;
            this.yScale = this.yScale ?? lineOptions.y;
            // TODO: determine y range
            this.lines.push(new ChartLine(lineOptions));
        });

        this.xAxis = this.node.append('g').attr("transform", `translate(0,${this.height - this.margin.bottom})`);
        if (!this.independentScale) {
            this.yAxis = this.node.append('g').attr("transform", `translate(${this.margin.left},0)`);
        }
//            .call(d3.axisBottom(this.xScale));
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
        this.simulationTable = new SimulationTable();
        this.valuesChart = new ValuesChart({ selector: ".sim-chart", width: 800, height: 300 });
        this.controlChart = new ControlChart({ selector: ".sim-chart", width: 800, height: 150, independentScale: true });
        this.stateChart = new StateChart({ selector: ".sim-chart", width: 800, height: 150, independentScale: true });
    }

    update (simulation) {
        this.simulationTable.update(simulation);
        this.valuesChart.update(simulation);
        this.controlChart.update(simulation);
        this.stateChart.update(simulation);
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

    namedParameter (name) {
        return this.parametersForm.querySelector(`input[name='${name}']`);
    }

    floatParam (name) {
        return Number.parseFloat(this.namedParameter(name).value);
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
