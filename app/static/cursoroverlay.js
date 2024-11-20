//const { ipcRenderer: ipc, remote } = require('electron');

window.onload = function () {
    //cursorvars = window.process.argv.slice(-4);

    var params = [];
    let i = 0;
    window.process.argv.forEach(function (param) {
        if (i > 0 && param.substring(0, 1) != '-' && param.substring(0, 1) != '/') {
            params.push(param);
        }
        i++;
    });

    document.getElementById("cursorname").innerHTML = params[1];
    document.getElementById("cursorname").style.color = "#" + params[2];
    document.getElementById("cursorname").style.border = "1px solid #" + params[2];
    /*
    ipc.send("get-cursorname", {});

    ipc.on("cursorname", (event, data) => {
        
    })*/
}