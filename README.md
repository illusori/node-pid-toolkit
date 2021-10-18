# node-pid-toolkit

Flexible pluggable PID controller toolkit for node.

Most PID implementations are fairly opinionated in how they behave and what set of features to implement. PID-Toolkit aims to instead provide a framework to implement a PID using the particular mix ofbehaviours you want via middlewares.

## Uh, what's a PID controller?

PID stands for Proportional, Integral, and Derivative. It's a type of controller that attempts to adjust a control to adjust an observed value (the "process variable") until it meets a target value (the "set point"). It does this by making the control output be proportional to the error (the gap between target and observed value), the rate of change of the error (the derivative) and the accumulated error over time (the integral).

You can, roughly speaking, visualise this as being proprtional to how wrong the value is (error), looking forwards at how rapidly we're correcting the error (the derivative), and looking backwards at how wrong we've been in the past (the integral).

Scaling to all three of these components compensates for short-comings in each.

That's the theory at least, in practice there's some complications with the naive simple approach and so there's various compensation techniques that eleborate on it, but there's no commonly-accepted "perfect" approach. That's where PID-Toolkit comes in: you can pick and choose which modifications to basic behaviour you wish to apply.

And because it's hard to visualise just what these changes do, it comes with an [in-browser sandbox](https://illusori.github.io/node-pid-toolkit/sandbox.html) to visualise the effects as you toggle them on and off.

# Install

Not on npm yet, so you'll have to download it the old fashioned way. FIXME: update once it's released.

# Usage

```js
const { PID } = require('pid');
const { Basic } = require('behaviours/basic');
const { SmoothValue } = require('behaviours/smooth-value');

let pid = new PID({
    t: 0,
    kP: 0.05,
    tI: 10,
    tD: 4,
    behaviours: [
        new Basic(),
        new SmoothValue({
            value: 'rateError',
            smoothFactor: 0.3
        }),
        new SmoothValue({
            'pV',
            smoothFactor: 0.5
        })
    ]
    );

// Value we want to target.
pid.sP = 100;

let timer = setInterval(() => {
    // Read this from your sensor
    let pV = measurementFromSomeSensor;
    let t = timeOfMeasurement; // defaults to performance.now() if not provided.

    let control = pid.update(pV, t);

    // control isn't clamped, and the value is largely meaningless based on the gain you provided
    // I personally tend to choose the gain so that it's meaningful on a -1.0..1.0 range,
    // and then map that to max controller input, but it's really up to you.
    someControl.setOutput(control);
}, 1000);
```

# LICENSE

Distributed under an MIT license, terms in the LICENSE.md file in the root of the distribution.
