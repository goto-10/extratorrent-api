module.exports = {
    detect: function(str) {
        return (this.get_parts(str).length > 0);
    },

    get_parts: function(str) {
        try {
            var pngB64 = 'iVBORw0KGgoAAAANSUhEU'+str.split("'iVBORw0KGgoAAAANSUhEU")[1].split("'")[0];
            var shiftVal = str.split('=[0,255,')[1].split('];')[0];
        } catch(e) {
            return '';
        }

        return [pngB64, shiftVal];
    },

    unpack: function(str) {
        var p = this.get_parts(str);
        //console.log(p[0].length, p[1]);

        if(!p[0] || isNaN(p[1])) {
            return str;
        }

        var resultStr = '';

        var imgObj, canvasObj;

        if(typeof(window) === 'undefined') {
          var Canvas = require('canvas');

          imgObj = new Canvas.Image;
          imgObj.src = new Buffer(p[0], 'base64').toString('binary');
          canvasObj = new Canvas(imgObj.width, imgObj.height);
        }
        else {
          imgObj = new window.Image();
          imgObj.style.display = 'none';
          imgObj.src = 'data:image/png;base64,'+p[0];

          canvasObj = window.document.createElement('canvas');
          canvasObj.width = imgObj.width;
          canvasObj.height = imgObj.height;
          canvasObj.style.display = 'none';
        }

        var canvasCtx = canvasObj.getContext('2d');
        canvasCtx.drawImage(imgObj, 0, 0);

        var imgData = canvasCtx.getImageData(0, 0, canvasObj.width, canvasObj.height);

        for(var i=parseInt(p[1]); i < imgData.data.length; i+=4) {
            resultStr += (imgData.data[i] != 255) ? String.fromCharCode(imgData.data[i]) : ''; 
        }
        resultStr=resultStr.trim();

        //console.log(window.atob(resultStr));
        return unescape(decodeURIComponent(window.atob(resultStr)));
    },
};
