/* jshint esversion: 9, node: true */
"use strict";

(function (document, window, undefined) {

const { PID } = require('../lib/pid');

class Simulation {
    constructor () {
        this.sP = 20;
        this.pV = 0;
        this.control = 0;
        this.restrictedControl = 0;
        this.effectiveControl = 0;
        this.dT = 1;
        this.authority = [7, 10];
        this.saturation = [-1, 1];

        this.pid = new PID({
          t: 0,
          kP: 0.2,
          tI: 2,
          tD: 5,
        });

        this.reset();
    }

    reset () {
        this.t = 0;
        this.data = [];
        this.pid.reset(this.t);
        this.pid.sP = this.sP;
    }

    update (dT) {
        this.t += dT;

        // Apply control to "simulation"
        this.pV += this.effectiveControl * dT;

        // Update and display PID.
        this.control = this.pid.update(this.pV, this.t);

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
            restrictedControl: this.restrictedControl,
            effectiveControl:  this.effectiveControl,
        });
    }

    run () {
        for (let i = 0; i < 50; i++) {
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

        this.lines = [];
        options.lines.forEach(line => {
            let lineOptions = Object.assign({}, line);
            lineOptions.chart = this;
            lineOptions.x = d3.scaleLinear().range([0, this.width]);
            lineOptions.y = d3.scaleLinear().range([this.height, 0]);
            // TODO: determine y range
            this.lines.push(new ChartLine(lineOptions));
        });
    }

    update (simulation) {
        this.lines.forEach(line => {
            line.update(simulation);
            // FIXME: move the draw into ChartLine???
            this.node.append('path')
                .attr("fill", "none")
                .attr("stroke", line.color)
                .attr("stroke-width", 1.5)
                .attr("d", line.line(simulation.data));
        });
    }
}

class ChartLine {
    constructor (options) {
        Object.assign(this, options); // ew h4x
        //'name color value x y'.split(' ').forEach(prop => {
        //    this[prop] = options[prop];
        //});
        this.line = d3.line()
            .x(d => this.x(d.frame.t))
            .y(d => this.y(this.value(d)));
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
                    name: 'pV',
                    value: d => d.frame.pV,
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

class ResultsDisplay {
    constructor() {
        this.simulationTable = new SimulationTable();
        this.valuesChart = new ValuesChart({ selector: ".sim-chart", width: 800, height: 400 });
        this.controlChart = new ControlChart({ selector: ".sim-chart", width: 800, height: 200, independentScale: true });
    }

    update (simulation) {
        this.simulationTable.update(simulation);
        this.valuesChart.update(simulation);
        this.controlChart.update(simulation);
    }
}

class App {
    constructor () {
        this.simulation = new Simulation();
        this.resultsDisplay = new ResultsDisplay();
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
