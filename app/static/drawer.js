//const { ipcRenderer: ipc, remote } = require('electron');
// Set up our drawing context
const electron = require("electron");

drawing = false;
var latestPoint = {};
var pointhistory = {};
var paintcheckinterval = null;
var drawcanvas = null;
var drawcanvascontext = null;

window.onload = function () {
    document.querySelector("#canvas").style.width = document.body.clientWidth + "px";
    document.querySelector("#canvas").style.height = document.body.clientHeight + "px";
    //document.querySelector("#canvas").style.left = (remotevideosize.x-2)+"px";
    //document.querySelector("#canvas").style.top = (remotevideosize.y-2)+"px";
    drawcanvas = document.querySelector("#canvas");
    drawcanvascontext = drawcanvas.getContext("2d");
    if (document.body.clientWidth != drawcanvascontext.canvas.width) {
        drawcanvascontext.canvas.width = document.body.clientWidth;
        drawcanvascontext.canvas.height = document.body.clientHeight;
    }


    electron.ipcRenderer.on('mouse-down', async function (e, args) {
        var obj = JSON.parse(args);
        console.log("mouse-down");
        console.log(args);
        startStroke(obj.id, [obj.x, obj.y]);
    });
    electron.ipcRenderer.on('mouse-up', async function (e, args) {
        var obj = JSON.parse(args);
        console.log("mouse-up");
        drawing = false;
    });
    electron.ipcRenderer.on('mouse-move', async function (e, args) {
        var obj = JSON.parse(args);
        console.log("mouse-move");
        console.log(args);
        if (drawing) {
            continueStroke(obj.id, obj.color, [obj.x, obj.y]);
        }
    });
}

function continueStroke(id, color, newPoint) {
    if (pointhistory[id] == undefined) {
        pointhistory[id] = [];
    }

    pointhistory[id].push({ color: color, from: latestPoint[id], to: newPoint, timestamp: Date.now(), opacity: 1.0 });
    latestPoint[id] = newPoint;
    repaintStrokes();
}


function repaintStrokes() {


    drawcanvascontext.clearRect(0, 0, drawcanvas.width, drawcanvas.height);
    Object.keys(pointhistory).forEach(key => {
        pointhistory[key].forEach((item) => {
            drawcanvascontext.beginPath();
            drawcanvascontext.moveTo(Math.round(item.from[0]), Math.round(item.from[1]));

            drawcanvascontext.strokeStyle = "rgba(" + hexToRgb(item.color).r + ", " + hexToRgb(item.color).g + ", " + hexToRgb(item.color).b + ", " + item.opacity + ")";
            drawcanvascontext.lineWidth = 5;
            drawcanvascontext.lineCap = "round";
            drawcanvascontext.lineJoin = "round";
            drawcanvascontext.lineTo(Math.round(item.to[0]), Math.round(item.to[1]));
            drawcanvascontext.stroke();
        });
    });
}

// Event helpers
function startStroke(id, point) {
    drawing = true;
    latestPoint[id] = point;

    if (paintcheckinterval == undefined || paintcheckinterval == null) {
        paintcheckinterval = setInterval(function () {
            Object.keys(pointhistory).forEach(key => {
                var tmp = [];
                var i = 0;
                pointhistory[key].forEach((item) => {
                    //if (item.timestamp != undefined) {
                    if (item.timestamp >= (Date.now() - 8000)) {
                        tmp.push(item);
                    }
                    if (item.timestamp < (Date.now() - 8000) && item.timestamp > (Date.now() - 20000)) {
                        item.opacity = item.opacity - 0.03;
                        tmp.push(item);
                    }
                    //}
                    i++;
                });
                pointhistory[key] = tmp;
            });
            repaintStrokes();
        }, 50);
    }
};



function hexToRgb(hex) {
    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}