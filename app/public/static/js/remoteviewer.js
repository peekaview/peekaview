var socket;

// gedrückte Keys
var keypressed;
var controlpressed = false;
var shiftpressed = false;
var spacepressed = false;
var synchronized = false;
var remoteclipboard = false;

// Skalierungsinfos
var scale = 1;          // Skalierung im Browser im Verhältnis zur Videogröße
var remotescale = 1;    // Skalierung Remotedesktop im Verhältnis zur Videogröße
var remotevideosize = { 'width': 0, 'height': 0 };         // initial
var windowdimensions = { 'width': 0, 'height': 0 };         // initial

// Panzoom - Scale und Panning im Browser
var zoom = null;            // lokales Zoomlevel zwischenspeichern
var panzoom = null;         // panzoom
var lastpanscale = 1;
var lastpan = { 'x': 0, 'y': 0 };

// Mauszeiger
var x = 0;
var y = 0;
var lastmove = 0;

// Screensharing oder Windowsharing aktiv?
var screensharing = true;
var lastmessage = null;

// Maus-Overlays
var signals = {};
var overlaycursor = {};
var overlaycursorlastaction = {};
var cursorcheckinterval = null;

// Remote-Funktionen
var mouseenabled = true;
var remotecontrol = false;

// URL-Params
let params = new URLSearchParams(document.location.search);
console.log("Full URL:", document.location.href);
console.log("Search string:", document.location.search);
console.log("All params:", Object.fromEntries(params));


var room = params.get("roomid");  // changed from "room" to "roomname"
var user = params.get("username");  // changed from "user" to "username"
var id = params.get("userid");      // changed from "userid" to "userid" (this one was correct)
var color = params.get("color");
var hostname = params.get("hostname");

console.log(hostname)

// Websocket-Message Object
var obj = {
    "x": 0,
    "y": 0,
    "room": room,
    "id": id,
    "name": user,
    "color": color
}
var lastobj;


// filetransfer aktiv?
var filetransfer = false;

// Messages
var msgmousesync = document.createElement('div');
msgmousesync.id = 'mousesync';
msgmousesync.classList.add('message');
msgmousesync.style.cssText = 'opacity: 0.8; z-index: 1001; pointer-events: none';
msgmousesync.innerHTML = '<b>aktive Remotesitzung - Verbindung wird hergestellt</b><img style="float: left; margin-right: 50px;" src="img/loading_dark.gif"><br><br>' + (!is_touch_enabled() ? 'STRG + MAUSRAD für Zoom<br>mittlere MAUSTASTE oder gedrückte Leertaste zum Verschieben<br>CTRL + C/CTRL + V zum Einfügen von Texten/Dateien/Bildern' : '');

var msgfiledrop = document.createElement('div');
msgfiledrop.id = 'filedrop';
msgfiledrop.classList.add('message');
msgfiledrop.style.cssText = 'padding-left: 100px; position: absolute; z-index: 1002; color: white; background: #000; opacity: 0.8; padding:20px; min-width: 500px; width: 100vw; pointer-events: none';
msgfiledrop.innerHTML = '<b>Datei per Drag-and-Drop an alle Teilnehmer verteilen... (max 10MB)</b><br><br>Die Datei wird direkt an die Teilnehmer gesendet.<br>Wenn Sie eine Datei dauerhaft speichern wollen, verwenden Sie den Datei-Bereich oben.';

var msgfileupload = document.createElement('div');
msgfileupload.id = 'transfer';
msgfileupload.classList.add('message');
msgfileupload.style.cssText = 'padding-left: 100px; position: absolute; z-index: 1003; color: white; background: #000; opacity: 0.8; padding:20px; min-width: 500px; width: 100vw; pointer-events: none';
msgfileupload.innerHTML = '<b>Datei wird hochgeladen...</b><br><br>Es kann etwas dauern, bis alle Teilnehmer die Datei erhalten haben.<img style="float: left; margin-right: 50px;" src="img/loading_dark.gif">';

var msgremotecontrol = document.createElement('div');
msgremotecontrol.id = 'remotecontrol';
msgremotecontrol.classList.add('message');
msgremotecontrol.style.cssText = 'padding-left: 100px; position: absolute; z-index: 1004; color: white; background: #000; opacity: 0.8; padding:20px; min-width: 500px; width: 100vw; pointer-events: none';
msgremotecontrol.innerHTML = '<b>Maus/Tastatursteuerung wurde aktiviert</b>';

var sizeinfo = document.createElement('div');
sizeinfo.id = 'sizeinfo';
sizeinfo.style.cssText = '';


// Drawing state
let drawing = {};           // Benutzer malt gerade? 
var drawcanvas = {};        // Canvas der Benutzer
var pointhistory = {};      // Punktarrays der Benutzer
var latestPoint = {};       // jeweils letzter Punkt
var paintcheckinterval = null;  // Repaint-Intervall

// Disable Browser-Zoom
//(function () {
document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.which === 61 || e.which === 107 || e.which === 173 || e.which === 109 || e.which === 187 || e.which === 189)) {
        e.preventDefault();
    }
}, false);

const handleWheel = function (e) {
    console.log("wheel")
    if (e.ctrlKey || e.metaKey)
        e.preventDefault();
};
document.addEventListener("wheel", handleWheel, { passive: false });
//})();


window.onload = function () {


    // get the color for a user
    //fetch("https://" + document.location.hostname.replace('ps-', '') + "/api/clientapi.php?action=color&user=" + user).then(response => response.text()).then(response => { color = response; });

    // Socket can survive browser-refresh, start with a new one
    if (socket != null) {
        socket.disconnect();
        socket.close();
    }

    socket = io.connect(hostname);

    socket = io(hostname, {
        transports: ['websocket', 'polling'],
        withCredentials: true
    });
    
    console.log("connect to controlserver:", hostname)
    socket.emit("join-message", room);


    document.body.appendChild(msgmousesync);    // display syncmessage
    document.body.appendChild(sizeinfo);        // show rectangular with sizeinfo


    // allow panning and zooming for #overlay element
    var overlay = document.querySelector("#overlay");
    if (is_touch_enabled()) {
        panzoom = Panzoom(overlay, { canvas: true, maxScale: 3, minScale: 1 });
    } else {
        panzoom = Panzoom(overlay, {
            canvas: true, maxScale: 3, minScale: 1, handleStartEvent: event => {
                if (event.button !== 1 && !spacepressed) {
                    throw "use middle button for panning"
                } else {
                    event.stopPropagation()
                    event.preventDefault()
                }
            }
        });
    }

    // Mousewheel-Zoom
    var overlaycontainer = overlay.parentElement
    overlaycontainer.addEventListener('wheel', function (event) {
        if (!event.ctrlKey) return
        if (event.deltaY < 0) {
            panzoom.zoom(panzoom.getScale() + 0.1, { animate: true });
        } else {
            panzoom.zoom(panzoom.getScale() - 0.1, { animate: true });
        }
    })

    // Änderungen zoom/panning in Variable zwischenspeichern
    overlay.addEventListener('panzoomchange', (event) => {
        zoom = event.detail;
        console.log(event.detail) // => { x: 0, y: 0, scale: 1 }
    })

    // alle 50ms werden die aktuellen Zoom-Infos an den Videoviewer gesendet
    setInterval(function () {
        let pan = panzoom.getPan()
        let panscale = panzoom.getScale()

        let scaleinfo = JSON.stringify({ 'action': 'setscale', 'scaleinfo': { 'x': pan.x, 'y': pan.y, 'scale': panscale, 'width': windowdimensions.width, 'height': windowdimensions.height } });
        window.parent.postMessage(scaleinfo, '*');

        if (pan.x != lastpan.x || pan.y != lastpan.y || panscale != lastpanscale) {
            lastpanscale = panscale;
            lastpan = pan;

            let reset = false;
            if ((pan.x > 0 || pan.y > 0) && panscale <= 1) {
                pan.x = 0;
                pan.y = 0;
                reset = true;
            }

            // Adjust child starting X/Y according the new scale for panning
            if (reset) {
                panzoom.pan(pan.x, pan.y, {
                    animate: true
                })
                reset = false;
            }

            let scaleinfo = JSON.stringify({ 'action': 'setscale', 'scaleinfo': { 'x': pan.x, 'y': pan.y, 'scale': panscale, 'width': windowdimensions.width, 'height': windowdimensions.height } });
            //console.log(scaleinfo);
            window.parent.postMessage(scaleinfo, '*');
        }
    }, 50);

    // Der Videoviewer sendet seine Informationen zur Videogröße, sizeinfo und Overlay werden entsprechend angepasst, so dass sie das Video genau überlagern
    window.addEventListener("message", (event) => {
        console.log(event);
        var obj = JSON.parse(event.data);
        if (obj.action == 'videosize') {
            remotevideosize = obj.sizeinfo;

            document.querySelector("#sizeinfo").style.width = remotevideosize.fullwidth + "px";
            document.querySelector("#sizeinfo").style.height = remotevideosize.fullheight + "px";
            document.querySelector("#sizeinfo").style.left = (remotevideosize.x - 2) + "px";
            document.querySelector("#sizeinfo").style.top = (remotevideosize.y - 2) + "px";

            // Canvas anpassen
            Object.keys(drawcanvas).forEach(key => {
                drawcanvas[key].style.width = remotevideosize.fullwidth + "px";
                drawcanvas[key].style.height = remotevideosize.fullheight + "px";
                var drawcanvascontext = drawcanvas[key].getContext("2d");
                if (remotevideosize.fullwidth != drawcanvascontext.canvas.width) {
                    drawcanvascontext.canvas.width = remotevideosize.fullwidth;
                    drawcanvascontext.canvas.height = remotevideosize.fullheight;
                }
            });


            document.querySelector("#overlay").style.width = (remotevideosize.width) + "px";
            document.querySelector("#overlay").style.height = (remotevideosize.height) + "px";
            document.querySelector("#overlay").style.left = Math.round((remotevideosize.x - 2) - (remotevideosize.fullwidth / remotevideosize.width * lastpan.x) + ((remotevideosize.fullwidth - remotevideosize.width) / 2)) + "px";
            document.querySelector("#overlay").style.top = Math.round((remotevideosize.y - 2) - (remotevideosize.fullwidth / remotevideosize.width * lastpan.y) + ((remotevideosize.fullheight - remotevideosize.height) / 2)) + "px";
        }
    }, false);


    // virtueller Mauszeiger
    function mouseMove(data) {
        var obj = JSON.parse(data);
        // Mauszeiger erstellen (nur bei Windowsharing, beim Screensharing bleibt stattdessen der Remotemauszeiger sichtbar)
        if (synchronized && overlaycursor[obj.id] == undefined && !screensharing) {
            htmlString = '<div id="' + obj.id + '" style="transition: all 0.05s ease-out; pointer-events: none; float:left; width:300px; position: absolute; z-index:99">' + ((id != obj.id) ? '<img src="img/cursor.png" style="float: left; height: 25px; width: 25px; " />' : '') + '<div id="cursorname" style="float:left; width: auto; margin-left: 10px; margin-top: 10px; border: 1px solid #' + obj.color + '; background: white; color: #' + obj.color + '; font-size:12px; padding:4px">' + obj.name + '</div></div>';
            var div = document.createElement('div');
            div.innerHTML = htmlString.trim();
            overlaycursor[obj.id] = div.firstChild;
            document.querySelector("#overlay").appendChild(overlaycursor[obj.id]);

            // Mauszeiger nach 10 Sekunden Inaktivität ausblenden
            if (cursorcheckinterval == null) {
                cursorcheckinterval = setInterval(function () {
                    clearMouseCursors();
                }, 1000);
            }
        }

        // Positionierung
        if (synchronized && !screensharing) {
            overlaycursorlastaction[obj.id] = Date.now();

            overlaycursor[obj.id].style.left = Math.round(obj.x * (scale * remotescale)) + "px";
            overlaycursor[obj.id].style.top = Math.round(obj.y * (scale * remotescale)) + "px";


        }
    }


    function clearMouseCursors() {
        // this.overlaycursorlastaction[id];
        Object.entries(overlaycursor).forEach(entry => {
            const [key, value] = entry;
            if (overlaycursorlastaction[key] != undefined && overlaycursorlastaction[key] < (Date.now() - 10000)) {
                console.log("remove cursor " + key);
                if (overlaycursor[key] != null) {
                    overlaycursor[key].remove();
                    overlaycursor[key] = undefined;
                }
            }
        });
    }

    // virtuelles Clipboard, Filesharing via Websockets
    // Todo, in eigene JS auslagern, da mehr oder weniger baugleich mit Filesharing in meetzi-App
    function pasteFile(data) {
        if (document.querySelector('#clipboardcontainer') != null) {
            document.querySelector('#clipboardcontainer').remove();
        }

        var clipboarddiv = document.createElement('div');
        clipboarddiv.style.cssText = 'position: absolute; right:0px; bottom:0px';
        clipboarddiv.id = 'clipboardcontainer';
        clipboarddiv.innerHTML = '<div class="button" onClick="document.querySelector(\'#clipboardcontainer\').remove();" style="margin-bottom: 5px;">Clipboard schliessen</div><div class="button copybutton" id="copybutton">Kopieren</div><div class="button downloadbutton" id="downloadbutton">Download</div><div id="clipboardarea"></div>';
        document.body.append(clipboarddiv);
        
        var datestring = (new Date().toLocaleString().replaceAll('/', '-').replaceAll(', ', '_').replaceAll(':', '-'));
        var obj = JSON.parse(data);

        //console.log(data);
        document.querySelectorAll('#transfer').forEach((message) => { message.remove() });
        if (obj.filecontent.startsWith('data:application/octet-stream')) {
            try {
                let decoded = b64DecodeUnicode(obj.filecontent.replace('data:application/octet-stream;base64,', ''));
            } catch (e) {
                obj.filecontent = obj.filecontent.replace('data:application/octet-stream', 'data:application/bin');
            }
        }

        if (obj.filecontent.startsWith('data:image/')) {
            let filetype = obj.filecontent.split('data:')[1].split(';base64,')[0];
            let extension = filetype.split('/')[1];

            // Wenns ein Bild ist, aber mime-Extension Sonderzeichen enthält, dann ists irgendein komisches Format und wir nehmen png als Default
            if (extension.includes('.') || extension.includes('-')) {
                extension = 'png';
            }
            // Wenn per Drag&Drop kommt, ist der Filename bekannt, dann darauf die Extension bestimmen
            if (obj.filename != undefined) {
                extension = obj.filename.split('.').slice(-1);
            }

            const div = document.createElement('div');
            div.innerHTML = '<center><img id="extensionimage" src="' + obj.filecontent + '" style="max-height:150px; max-width:150px; opacity: 0.8"></center>';
            document.getElementById('clipboardarea').append(div);

            // Klick aufs Bild = Download
            document.querySelector("#extensionimage").onclick = function () {
                document.querySelector("#downloadbutton").click();
            };

            document.querySelector("#downloadbutton").onclick = function () {
                const downloadLink = document.createElement('a');
                document.body.appendChild(downloadLink);
                downloadLink.href = obj.filecontent;
                downloadLink.target = '_self';
                if (obj.filename != undefined) {
                    downloadLink.download = obj.filename;
                } else {
                    downloadLink.download = 'download_' + datestring + '.' + extension;
                }
                downloadLink.click();
            };


            document.querySelector("#copybutton").style.display = 'inline';
            document.querySelector("#copybutton").onclick = function () {
                let img = document.querySelector("#extensionimage");
                const canvas = document.createElement('canvas')
                canvas.width = img.naturalWidth
                canvas.height = img.naturalHeight
                const context = canvas.getContext('2d')
                context.drawImage(img, 0, 0)
                canvas.toBlob(blob => {
                    navigator.clipboard.write([
                        new ClipboardItem({
                            [blob.type]: blob
                        })
                    ]).then(() => {
                        console.log('Copied')
                    })
                })
            };


            document.getElementById('clipboardarea').append(div);
        }
        else if (obj.filecontent.startsWith('data:application/octet-stream') || obj.filecontent.startsWith('data:text/') || obj.filecontent.startsWith('data:application/json')) {
            let filetype = obj.filecontent.split('data:')[1].split(';base64,')[0];
            //let b64data = obj.filecontent.split(';base64,')[1];
            let extension = filetype.split('/')[1];

            const div = document.createElement('div');
            let decoded = '';
            if (obj.filecontent.startsWith('data:application/octet-stream')) {
                decoded = b64DecodeUnicode(obj.filecontent.replace('data:application/octet-stream;base64,', ''));
            } else {
                decoded = atob(obj.filecontent.split(';base64,')[1]);
            }
            if (decoded.includes('<?php')) {
                extension = 'php';
            }
            if (extension.includes('.') || extension.includes('-')) {
                extension = 'txt';
            }

            if (obj.filename != undefined) {
                extension = obj.filename.split('.').slice(-1);
            }

            div.style.cssText = 'background-image: url(/assets/icons/' + extension + '.svg); background-repeat: no-repeat; background-position-x: right';
            div.innerHTML = '<textarea id="filecontent" style="background: hsl(0deg 62% 55% / 85%)">' + decoded + '</textarea>';

            //console.log(decoded);

            document.getElementById('clipboardarea').append(div);

            document.querySelector("#downloadbutton").onclick = function () {
                const downloadLink = document.createElement('a');
                document.body.appendChild(downloadLink);
                downloadLink.href = obj.filecontent;
                downloadLink.target = '_self';
                if (obj.filename != undefined) {
                    downloadLink.download = obj.filename;
                } else {
                    downloadLink.download = 'download_' + datestring + '.' + extension;
                }
                downloadLink.click();
            };

            document.querySelector("#copybutton").style.display = 'inline';
            document.querySelector("#copybutton").onclick = function () {
                //document.querySelector("textarea").select();
                navigator.clipboard.writeText(document.querySelector("textarea").value);

                //document.execCommand('copy');
            };

        }
        else if (obj.filecontent.startsWith('data:application/')) {
            let filetype = obj.filecontent.split('data:')[1].split(';base64,')[0];
            let extension = filetype.split('/')[1];

            extension = extension.replace('x-msdownload', 'exe');
            extension = extension.replace('x-zip-compressed', 'zip');

            if (extension.includes('.') || extension.includes('-')) {
                extension = 'bin';
            }

            if (obj.filename != undefined) {
                extension = obj.filename.split('.').slice(-1);
            }

            //console.log(extension);

            const div = document.createElement('div');
            div.innerHTML = '<center><img id="extensionimage" src="/assets/icons/' + extension + '.svg" style="max-height:150px"></center>';
            document.getElementById('clipboardarea').append(div);

            document.querySelector("#extensionimage").onclick = function () {
                document.querySelector("#downloadbutton").click();
            };

            document.querySelector("#downloadbutton").onclick = function () {
                const downloadLink = document.createElement('a');
                document.body.appendChild(downloadLink);
                downloadLink.href = obj.filecontent;
                downloadLink.target = '_self';
                if (obj.filename != undefined) {
                    downloadLink.download = obj.filename;
                } else {
                    downloadLink.download = 'download_' + datestring + '.' + extension;
                }
                downloadLink.click();
            };
        }
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



        Object.keys(pointhistory).forEach(key => {

            //console.log("stroke for "+key);
            // add a canvas for the user strokes
            if (drawcanvas[key] == undefined) {
                //console.log("canvas for "+key);
                drawcanvas[key] = document.createElement('canvas');
                drawcanvas[key].id = 'canvas_' + key;
                drawcanvas[key].style.cssText = 'position: absolute';
                document.querySelector("#overlay").appendChild(drawcanvas[key]);
            }

            var drawcanvascontext = drawcanvas[key].getContext("2d");
            drawcanvascontext.clearRect(0, 0, drawcanvas[key].width, drawcanvas[key].height);
            pointhistory[key].forEach((item) => {
                //console.log(item);
                if (item.from != undefined) {
                    drawcanvascontext.beginPath();
                    drawcanvascontext.moveTo(Math.round(item.from[0] * (scale * remotescale)), Math.round(item.from[1] * (scale * remotescale)));
                    drawcanvascontext.strokeStyle = "rgba(" + hexToRgb(item.color).r + ", " + hexToRgb(item.color).g + ", " + hexToRgb(item.color).b + ", " + item.opacity + ")";
                    drawcanvascontext.lineWidth = 5;
                    drawcanvascontext.lineCap = "round";
                    drawcanvascontext.lineJoin = "round";
                    drawcanvascontext.lineTo(Math.round(item.to[0] * (scale * remotescale)), Math.round(item.to[1] * (scale * remotescale)));
                    drawcanvascontext.stroke();
                }
            });
        });
    }

    // Event helpers
    var tmppointhistory = {}
    function startStroke(id, point) {


        drawing[id] = true;
        latestPoint[id] = point;

        if (paintcheckinterval == undefined || paintcheckinterval == null) {
            paintcheckinterval = setInterval(function () {
                Object.keys(pointhistory).forEach(key => {
                    tmppointhistory[key] = [];
                    pointhistory[key].forEach((item) => {
                        if (item.timestamp >= (Date.now() - 8000)) {
                            tmppointhistory[key].push(item);
                        }
                        if (item.timestamp < (Date.now() - 8000) && item.timestamp > (Date.now() - 20000)) {
                            item.opacity = item.opacity - 0.03;
                            tmppointhistory[key].push(item);
                        }
                    });
                    pointhistory[key] = tmppointhistory[key];
                });
                repaintStrokes();
            }, 50);
        }
    };


    // Signal einblenden bei Mausklick für 2000ms
    function mouseSignal(data) {
        var obj = JSON.parse(data);
        console.log(obj);

        if (!remotecontrol && !screensharing) {
            if (document.querySelector('#signal_' + obj.id) != undefined) {
                document.querySelector('#signal_' + obj.id).remove();
            }

            signals[obj.id] = document.querySelector("#container").cloneNode(true);
            signals[obj.id].id = 'signal_' + obj.id;
            document.querySelector("#overlay").appendChild(signals[obj.id]);

            document.querySelector('#signal_' + obj.id).style.left = Math.round(obj.x * (scale * remotescale) - 150) + "px";
            document.querySelector('#signal_' + obj.id).style.top = Math.round(obj.y * (scale * remotescale) - 150) + "px";

            document.querySelector('#signal_' + obj.id).style.display = "flex";
            document.querySelector('#signal_' + obj.id).style.pointerEvents = "none";

            try {
                document.querySelectorAll('#signal_' + obj.id + ' .cursorsignal').forEach((item) => {
                    item.style.backgroundColor = '#' + obj.color;
                });
            } catch (e) { }

            setTimeout(function () {
                if (document.querySelector('#signal_' + obj.id) != undefined) {
                    document.querySelector('#signal_' + obj.id).remove();
                }
            }, 2000);
        }
    }


    window.onresize = function (event) {
        calcScale();
    };


    function calcScale() {
        document.querySelector("#overlay").style.border = '1px solid blue';
        scale1 = document.querySelector("#overlay").getBoundingClientRect().width / remotevideosize.width;
        scale2 = document.querySelector("#overlay").getBoundingClientRect().height / remotevideosize.height;

        scale = scale1 < scale2 ? scale1 : scale2;
        if (scale > 1) {
            scale = 1;
        }
    }


    socket.on("getclipboard", function (data) {
        console.log("getclipboard");
        var obj = JSON.parse(data);
        console.log(obj);

        navigator.clipboard.writeText(obj.text);
    });

    socket.on("mouse-leftclick", function (data) {
        if (!remotecontrol) {
            mouseSignal(data);
        }

        obj = JSON.parse(data);
    });

    socket.on("mouse-move", function (data) {

        obj = JSON.parse(data);

        if (!remotecontrol && drawing[obj.id] != undefined && drawing[obj.id]) {
            continueStroke(obj.id, obj.color, [obj.x, obj.y]);
        }

        mouseMove(data);
    });

    /*socket.on("rectangle", function(data) {
        obj = JSON.parse(data);
        //createRectangle(obj);
    });*/

    socket.on("mouse-down", function (data) {


        obj = JSON.parse(data);
        console.log("mouse-down");
        console.log(obj);

        if (!filetransfer && (drawing[obj.id] == undefined || !drawing[obj.id])) {
            startStroke(obj.id, [obj.x, obj.y]);
        }
        //createRectangle(obj);
    });

    socket.on("mouse-up", function (data) {
        obj = JSON.parse(data);
        //mousepressed[obj.id] = false;
        console.log("mouse-up");
        console.log(obj);

        drawing[obj.id] = false;
        //finishRectangle(obj);
    });


    socket.on("pastefile", function (data) {
        console.log("pastefile");
        console.log(data);
        pasteFile(data);
    });

    socket.on('reset', function (message) {
        console.log(message);

        console.log("receivedreset");


        // Bei Screensharing sieht man den Remotemauszeige, daher den eigenen durch ein feines Crosshair ersetzen
        if (message.iscreen) {
            document.querySelector("#overlay").style.cursor = 'url(img/minicrosshair.png) 5 5, auto';
            screensharing = true;
        } else {
            document.querySelector("#overlay").style.cursor = 'default';
            screensharing = false;
        }


        console.log(remotevideosize.width);
        /*if (((message.dimensions.right - message.dimensions.left) - 0) * message.scalefactor > remotevideosize.width) {
            remotescale = (remotevideosize.width / ((message.dimensions.right - message.dimensions.left) - 0));
        } else {*/
        //remotescale = message.scalefactor;
        remotescaleheight = (remotevideosize.height / ((message.dimensions.bottom - message.dimensions.top) - 0));
        remotescalewidth = (remotevideosize.width / ((message.dimensions.right - message.dimensions.left) - 0));
        if (remotescaleheight < remotescalewidth) {
            remotescale = remotescaleheight;
        } else {
            remotescale = remotescalewidth;
        }
        //}


        // Speichern der Fensterabmessungen
        windowdimensions.width = message.dimensions.right - message.dimensions.left;
        windowdimensions.height = message.dimensions.bottom - message.dimensions.top;

        // Skalierungsinfos und Mauszeigerposition mit Remote-App synchronisiert
        if (lastmessage == null || lastmessage.dimensions.left != message.dimensions.left || lastmessage.dimensions.right != message.dimensions.right || lastmessage.dimensions.top != message.dimensions.top || lastmessage.dimensions.bottom != message.dimensions.bottom) {
            synchronized = false;
            calcScale();
        } else {
            synchronized = true;
        }
        if (synchronized && document.querySelector("#mousesync") != undefined) {
            document.querySelector("#mousesync").remove();
        }

        // Maus-Zeigermodus aktiviert/deaktiviert
        if ((lastmessage == null || mouseenabled != message.mouseenabled) && document.querySelector("#mousesync") == null) {
            msgremotecontrol.innerHTML = message.mouseenabled ? '<b>Remote-Mauszeiger ist nun aktiviert</b>' : '<b>Remote-Mauszeiger wurde deaktiviert</b>';
            document.querySelectorAll('.message').forEach((message) => { message.remove() });
            document.body.appendChild(msgremotecontrol);
            setTimeout(function () {
                document.querySelectorAll('.message').forEach((message) => { message.remove() });
            }, 3000);
            mouseenabled = message.mouseenabled;
            if (!mouseenabled) {
                clearMouseCursors();
            }
        }

        // Maus/Tastatursteuerung aktiviert/deaktiviert
        if ((lastmessage == null || remotecontrol != message.remotecontrol) && document.querySelector("#mousesync") == null) {
            msgremotecontrol.innerHTML = message.remotecontrol ? '<b>Fernzugriff ist jetzt aktiviert</b>' : '<b>Fernzugriff wurde deaktiviert</b>';
            document.querySelectorAll('.message').forEach((message) => { message.remove() });
            document.body.appendChild(msgremotecontrol);
            setTimeout(function () {
                document.querySelectorAll('.message').forEach((message) => { message.remove() });
            }, 3000);
            remotecontrol = message.remotecontrol;
        }



        lastmessage = message;
    });




    var lastposx = 0;
    var lastposy = 0;

    document.querySelector("#overlay").addEventListener('mouseenter', function() { 
        remoteclipboard = true; 
    });

    document.querySelector("#overlay").addEventListener('mousemove', function(e) {
        if (!mouseenabled) return false;
        if (!synchronized) return false;
        remoteclipboard = true;

        var rect = this.getBoundingClientRect();
        x = e.pageX - rect.left;
        y = e.pageY - rect.top;

        obj = {
            "x": Math.round(x / (scale * remotescale * zoom.scale)),
            "y": Math.round(y / (scale * remotescale * zoom.scale)),
            "room": room,
            "id": id,
            "name": user,
            "color": color
        }

        if ((lastmove < Date.now() - 100) || (lastmove < Date.now() - 50) && (Math.abs(lastposx - x) < 3 || Math.abs(lastposy - y) < 3)) {
            lastmove = Date.now()
            socket.volatile.emit("mouse-move", JSON.stringify(obj));
        }

        lastposx = x;
        lastposy = y;

        e.preventDefault();
        return false;
    });

    var lastwheel = 0;
    document.querySelector("#overlay").addEventListener('wheel', function (e) {
        if (event.ctrlKey) return;

        if (lastwheel < (Date.now() - 200)) {
            console.log(e);
            obj.delta = e.deltaY;
            lastwheel = Date.now();
            socket.emit("mouse-wheel", JSON.stringify(obj));
        }

    })

    var ignoremouse = 0;
    document.querySelector("#overlay").addEventListener('mousedown', function(e) {
        if (!mouseenabled) return false;
        if (!controlpressed && (ignoremouse < Date.now() - 500)) {
            if (e.which == 3) {
                sendMouseClick("mouse-click", e, this.getBoundingClientRect());
            } else {
                sendMouseClick('mouse-down', e, this.getBoundingClientRect());
            }
        } else {
            ignoremouse = Date.now();
        }
        lastobj = obj;
    });

    document.querySelector("#overlay").addEventListener('mouseup', function(e) {
        if (!mouseenabled) return false;
        if (!controlpressed && (ignoremouse < Date.now() - 500)) {
            sendMouseClick('mouse-up', e, this.getBoundingClientRect());
        }
    });

    var eventToSend = null;
    var lastmousedown = 0;
    //var lastclick = 0;
    var lastobj = null;
    //var mousepressed = {};

    function sendMouseClick(event, e, offset) {
        if (event == 'mouse-click') {
            lastmousedown = 0;
            //lastclick = 0;
            console.log("mouse-rightclick");
            socket.volatile.emit("mouse-click", JSON.stringify(obj));
        }
        if (event == 'mouse-down' && lastmousedown == 0) {

            lastmousedown = Date.now();

            eventToSend = setTimeout(function () {
                console.log("mouse-down");
                //mousepressed[lastobj.id] = true;

                socket.volatile.emit("mouse-down", JSON.stringify(lastobj));
            }, 150);
        }
        if (event == 'mouse-up') {
            if (lastmousedown > (Date.now() - 150)) {
                clearTimeout(eventToSend);
                console.log("mouse-leftclick");
                socket.volatile.emit("mouse-leftclick", JSON.stringify(lastobj));
            } else {
                //lastclick = 0;
                //lastmouseup = Date.now();
                console.log("mouse-up");

                //mousepressed[obj.id] = false;
                //finishRectangle(obj);
                socket.volatile.emit("mouse-up", JSON.stringify(obj));
                clearTimeout(eventToSend);
                eventToSend = null;
            }
            //mousepressed[obj.id] = false;
            lastmousedown = 0;
        }
    }


    window.addEventListener('keydown', function(e) {
        skip = false;
        if (e.key == " " || e.code == "Space" || e.keyCode == 32) {
            console.log('space pressed');
            spacepressed = true;
        }
        if (e.key == 'Shift') {
            console.log('shift pressed');
            shiftpressed = true;
        }
        if (e.key == 'Control' || e.key == 'Meta') {
            console.log('control pressed');
            controlpressed = true;
        }
        if (e.key == 'Alt' || e.key == 'AltGraph' || e.key == 'Shift' || e.key == 'CapsLock') {
            skip = true;
        }
        if (controlpressed && (e.key == 'Control' || e.key == 'Meta' || e.key == 'v' || e.key == 'c' || e.key == 'x')) {
            skip = true;
        }
        if (controlpressed && e.key != 'v' && e.key != 'c' && e.key != 'x' && (e.key.length === 1 && e.key.toLowerCase().match(/[a-z]/i) || e.key == 'Enter')) {
            e.key = '_____strg+' + e.key.toLowerCase();
        }

        if (!skip) {
            console.log(e.key);

            var obj = {
                "socketid": socket.id,
                "key": e.key,
                "room": room,
                "name": user,
                "color": color
            };
            //keypressmessage = JSON.stringify(obj);
            socket.emit('type', JSON.stringify(obj));
            e.preventDefault();
            return false;
        }
    })


    window.addEventListener('keyup', function(e) {
        if (e.key == 'Control' || e.key == 'Meta') {
            console.log('control released');
            controlpressed = false;
        }
        if (e.key == 'Shift') {
            console.log('shift released');
            shiftpressed = false;
        }

        clearInterval(keypressed);
        keypressed = null;
        e.preventDefault();
        return false;
    })


    document.querySelector('#overlay').addEventListener('contextmenu', function(e) {
        return false;
    });


    document.body.ondrop = function (ev) {
        console.log('File(s) dropped');
        filetransfer = false;

        // Prevent default behavior (Prevent file from being opened)
        ev.preventDefault();

        document.querySelectorAll('.message').forEach((message) => { message.remove() });
        document.body.appendChild(msgfileupload);


        if (ev.dataTransfer.items) {
            // Use DataTransferItemList interface to access the file(s)
            [...ev.dataTransfer.items].forEach((item, i) => {
                // If dropped items aren't files, reject them
                if (item.kind === 'file') {
                    var blob = item.getAsFile();
                    var itemtype = item.type;
                    var reader = new FileReader();
                    reader.onload = function (event) {
                        var obj = {
                            "filecontent": event.target.result,
                            "filename": blob.name,
                            "room": room,
                            "name": user,
                            "color": color
                        };
                        clipboarddata = JSON.stringify(obj);
                        socket.emit('pastefile', clipboarddata)


                    }; // data url!
                    reader.readAsDataURL(blob);



                    //const file = item.getAsFile();
                    //console.log(`… file[${i}].name = ${file.name}`);
                }
            });
        }/* else {
          // Use DataTransfer interface to access the file(s)
          [...ev.dataTransfer.files].forEach((file, i) => {
            console.log(`… file[${i}].name = ${file.name}`);
          });
        }*/
    };


    document.body.ondragover = function (ev) {
        if (document.querySelector('#filedrop') == null) {
            console.log('File(s) in drop zone');
            filetransfer = true;


            document.querySelectorAll('.message').forEach((message) => { message.remove() });
            document.body.appendChild(msgfiledrop);

            setTimeout(function () {
                document.querySelectorAll('#filedrop').forEach((message) => { message.remove() });
            }, 5000);
        }

        // Prevent default behavior (Prevent file from being opened)
        ev.preventDefault();
    };


    //var isafile = false;
    window.addEventListener('paste', function (e) {
        var items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (index in items) {
            var item = items[index];

            console.log(item);

            if (item.kind === 'string' && item.type.match('^text/plain')) {
                //alert('paste text');
                item.getAsString((clipText) => {
                    var obj = {
                        "text": clipText.replace(/\r/g, ""),
                        "room": room,
                        "name": user,
                        "color": color,
                        "time": Date.now()
                    };
                    //keypressmessage = ;
                    socket.emit('paste', JSON.stringify(obj));
                });
            } else if (item.kind === 'string' && item.type.match('^text/html')) {
                // Drag data item is HTML
                item.getAsString((clipText) => {
                    var obj = {
                        "text": clipText.replace(/\r/g, ""),
                        "room": room,
                        "name": user,
                        "color": color,
                        "time": Date.now()
                    };
                    //keypressmessage = ;
                    socket.emit('paste', JSON.stringify(obj));
                });
                //alert('paste html');
            } else if (item.kind === 'file') {
                var blob = item.getAsFile();
                var itemtype = item.type;
                var reader = new FileReader();
                reader.onload = function (event) {
                    var obj = {
                        "filecontent": event.target.result,
                        "room": room,
                        "name": user,
                        "color": color
                    };
                    clipboarddata = JSON.stringify(obj);
                    isafile = true;
                    socket.emit('pastefile', clipboarddata);

                    let obj2 = {};
                    obj2[itemtype] = blob;

                    navigator.clipboard.write([

                        new ClipboardItem(obj2),
                    ]);

                    //downloadBase64File(event.target.result,'config.php');
                }; // data url!
                reader.readAsDataURL(blob);
            }

        }
    });

    window.addEventListener('copy', function (e) {
        var obj = {
            "room": room,
            "socketid": socket.id,
        };
        if (remoteclipboard)
            socket.emit('copy', JSON.stringify(obj));
    });

    window.addEventListener('cut', function (e) {
        var obj = {
            "room": room,
            "socketid": socket.id,
        };
        if (remoteclipboard)
            socket.emit('cut', JSON.stringify(obj));
    });
}



function is_touch_enabled() {
    if (window.matchMedia("(pointer: coarse)").matches) {
        return true;
    }

    return false;
    return ('ontouchstart' in window) ||
        (navigator.maxTouchPoints > 0) ||
        (navigator.msMaxTouchPoints > 0);
}

function uuidv4() {
    return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );


}

function b64DecodeUnicode(str) {
    // Going backwards: from bytestream, to percent-encoding, to original string.
    return decodeURIComponent(atob(str).split('').map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
}



function hexToRgb(hex) {
    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}
