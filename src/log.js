export default function (message) {
    if (!loggingEnabled) return;

    console.log(`skribbl.io AutoDraw: ${message}`);
};

const loggingEnabled = true;
