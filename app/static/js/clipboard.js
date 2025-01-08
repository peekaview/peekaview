const electron = require("electron");

//const fileTypeFromBlob = import('file-type');
//import { fileTypeFromBlob } from 'file-type';

function b64DecodeUnicode(str) {
    // Going backwards: from bytestream, to percent-encoding, to original string.
    return decodeURIComponent(atob(str).split('').map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
}

const b64toBlob = (b64Data, contentType = '', sliceSize = 512) => {
    const byteCharacters = atob(b64Data);
    const byteArrays = [];

    for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
        const slice = byteCharacters.slice(offset, offset + sliceSize);

        const byteNumbers = new Array(slice.length);
        for (let i = 0; i < slice.length; i++) {
            byteNumbers[i] = slice.charCodeAt(i);
        }

        const byteArray = new Uint8Array(byteNumbers);
        byteArrays.push(byteArray);
    }

    const blob = new Blob(byteArrays, { type: contentType });
    return blob;
}


window.addEventListener("DOMContentLoaded", () => {
    electron.ipcRenderer.on('pasteFromFile', async function (e, args) {
        console.log("superduper");
        var datestring = (new Date().toLocaleString().replaceAll('/', '-').replaceAll(', ', '_').replaceAll(':', '-'));
        var obj = JSON.parse(args);

        console.log(args);

        if (obj.filecontent.startsWith('data:application/octet-stream')) {
            try {
                let decoded = b64DecodeUnicode(obj.filecontent.replace('data:application/octet-stream;base64,', ''));
            } catch (e) {
                obj.filecontent = obj.filecontent.replace('data:application/octet-stream', 'data:application/bin');
            }
        }


        if (obj.filecontent.startsWith('data:image/')) {
            let filetype = obj.filecontent.split('data:')[1].split(';base64,')[0];
            //let b64data = obj.filecontent.split(';base64,')[1];
            let extension = filetype.split('/')[1];

            if (extension.includes('.') || extension.includes('-')) {
                extension = 'png';
            }

            if (obj.filename != undefined) {
                extension = obj.filename.split('.').slice(-1);
            }

            console.log(extension);

            const div = document.createElement('div');
            //div.style.cssText = 'background-image: url(assets/icons/' + extension + '.svg)';
            div.innerHTML = '<center><img id="extensionimage" src="' + obj.filecontent + '" style="max-height:150px; max-width:150px; opacity: 0.8"></center>';
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

            div.style.cssText = 'background-image: url(icons/' + extension + '.svg); background-repeat: no-repeat; background-position-x: right;  max-height: 150px;  max-width: 150px;';
            div.innerHTML = '<textarea id="filecontent">' + decoded + '</textarea>';

            console.log(decoded);

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
                document.querySelector("textarea").select();
                document.execCommand('copy');
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

            console.log(extension);

            const div = document.createElement('div');
            div.innerHTML = '<center><img id="extensionimage" src="icons/' + extension + '.svg" style="max-height:150px"></center>';
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
    });
});

