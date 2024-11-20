const { electron, ipcRenderer } = require('electron')

//var windowid;

var params = [];
let i = 0;
window.process.argv.forEach(function (param) {
    if (i > 0 && param.substring(0, 1) != '-' && param.substring(0, 1) != '/') {
        params.push(param);
    }
    i++;
});
//console.log(window.process.argv);

//alert(params[0] + ";" + params[1] + ";" + params[2])
//console.log(params);


window.onload = async function () {
    sourceId = params[0].replaceAll('_', ':');
    //document.querySelector('.recordoverlayclosebutton').innerHTML = sourceId;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: sourceId,
                }
            }
        })
        //setSource(sourceId)
        handleStream(stream, sourceId, params[1], params[2])
    } catch (e) {
        handleError(e)
    }
}

function handleError(e) {
    console.log(e)
}