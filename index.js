var inboundChar;
var outboundChar;
var device;
var packet_count = 0;

// Define the CodeLess UUIDs 
var BPP_SVC_UUID = "0783b03e-8535-b5a0-7140-a304d2495cb7";
var RX_CHAR_UUID   = "0783b03e-8535-b5a0-7140-a304d2495cb8";
var TX_CHAR_UUID = "0783b03e-8535-b5a0-7140-a304d2495cba";

var no_data_yet = true;

var ecg_ts = new TimeSeries();
var ppg_ts = new TimeSeries();

var state = 0;
var receivedData = [];
var receivedDataIndex = 0;

var parsed_arr_ecg = [];
var parsed_arr_ppg = [];
var parsed_arr_index = 0;
var xValues = [];
var xyValues = [];

var val_data_compare_ppg = 0.0;
var val_data_compare_ecg = 0.0;
var val_data_compare_last_ppg = 0.0;
var val_data_compare_last_ecg = 0.0;
var val_data_same_start_ppg = 0.0;
var val_data_same_start_ecg = 0.0;
var val_data_same_end_ppg = 0.0;
var val_data_same_end_ecg = 0.0;
var val_line_same_start = 0;
var val_line_same_end = 0;
var g_num_line = 0;

var dataLog = "";

var downsample = 0;

var settingsArr = new Uint8Array(8);

var test_chart_len = 500;

var alg_mode = 1;

var raw_chart = new SmoothieChart(
    {
        millisPerPixel: 10,
        //timestampFormatter: SmoothieChart.timeFormatter,
        //interpolation: 'bezier',
        tooltip: true,
        labels: { fontSize: 15, fillStyle: '#FFFFFF', precision: 0 },
        //grid: { borderVisible: false, millisPerLine: 2000, verticalSections: 21, fillStyle: '#000000' }

    }
);

var ecg_chart = new SmoothieChart(
    {
        millisPerPixel: 10,
        //timestampFormatter: SmoothieChart.timeFormatter,
        //interpolation: 'linear',
        tooltip: true,
        labels: { fontSize: 15, fillStyle: '#FFFFFF', precision: 0 },
        //grid: { borderVisible: false, millisPerLine: 2000, verticalSections: 21, fillStyle: '#000000' },
        //maxValue:30000,minValue:-30000

    }
);

var test_chart = new Chart("bpchart", {
    type: "line",
    data: {
        labels: xValues,
        datasets: [{
            fill: false,
            pointRadius: 1,
            borderColor: "rgba(0,0,255,0.5)",
            //data: parsed_arr_ecg
            data: xyValues
        }]
    },
    options: {
        legend: { display: false },
        scales: {
            xAxes: [{ticks: { display: false }}],
          },
        // title: {
        //     display: true,
        //     text: "y = x * 2 + 7",
        //     fontSize: 16
        // }
    }
});

var algXvalues = ["SBP", "DBP"];
var algYvalues = [0, 0];
var barColors = ["red", "blue"];
var alg_chart = new Chart("algchart", {
    type: "bar",
    data: {
      labels: algXvalues,
      datasets: [{
        backgroundColor: barColors,
        data: algYvalues
      }]
    },
    options: {
      legend: {display: false},
      title: {
        display: true,
        text: "BP Algorithm"
      },
      scales: {
        xAxes: [{
            barPercentage: 0.5
        }],
        yAxes: [{
            ticks: {
                beginAtZero: true
            }
        }],
    }
    }
  });

// Display text in log field text area 
function log(text) {
    var textarea = document.getElementById('log');
    textarea.value += "\n" + text;
    textarea.scrollTop = textarea.scrollHeight;
}

function normalize(arr_in) {
    var arr_ret, val_max, val_min, val_range;
    val_min = Math.min(...arr_in);
    val_max = Math.max(...arr_in);
    val_range = val_max - val_min;

    var arr_ret = arr_in.map( function(value) { 
        return (value - val_min) / val_range;
    } );

    return arr_ret;
  }

// Incoming GATT notification was received
async function incomingData(event) {

    if (no_data_yet) {

        if (alg_mode == 1){
            document.getElementById('algchart').style.display = "none";
            document.getElementById('chart-area').style = "display:inline;";
            raw_chart.start();
            ecg_chart.start();
        }
        else{
            //document.getElementById('alg-chart-area').style = "display:inline;";
            document.getElementById('chart-area').style = "display:none;";
            document.getElementById('spinner').style = "display:none;";
            document.getElementById('algchart').style.display = "";
        }
       
        no_data_yet = false;

        for (let x = 0; x < test_chart_len; x++) {
            xValues.push(x);
          }
    }

    for (var i = 0; i < event.target.value.byteLength; i++) {
        val = event.target.value.getUint8(i);

        switch (state) {
            case 0:
                if (val == 0xf0) {
                    state = 1;
                }
                break;

            case 1:
                if (val == 0x0f) {
                    receivedData.length = 0;
                    receivedDataIndex = 0;
                    state = 2;
                }
                else {
                    state = 0;
                }
                break;

            case 2:
                receivedData[receivedDataIndex++] = val;

                if (receivedData.length == 6) {
                    state = 0;

                    if (alg_mode == 1){
                        parseRaw(receivedData);
                    }
                    else{
                        parseProcessed(receivedData);
                    }
                }
                break;
        }
    }
}

function parseRaw(data) {
    ppg = 0;
    ecg = 0;

    ppg = data[0] << 16;
    ppg |= data[1] << 8;
    ppg |= data[2];

    ecg = data[3] << 16;
    ecg |= data[4] << 8;
    ecg |= data[5];

    if (data[3] > 128) {
        ecg -= Math.pow(2, 24);
    }

    //TODO Calculate checksum

    document.getElementById("log").value = "";
    log('ECG: ' + ecg + ', PPG: ' + ppg);
    dataLog = dataLog + ppg + ', ' + ecg + '\n';

    graphRaw(ppg, ecg);
}

function parseProcessed(data) {
    var time = new Date();
    var time = formatDate(new Date(), "yyyy/MM/dd HH:mm:ss");

    sbp = 0;
    dbp = 0;
    rri = 0;

    sbpAvg = get_avg_SBP(data[2]);
    dbpAvg = get_avg_DBP(data[5]);

    sbp = sbpAvg.avg;
    dbp = dbpAvg.avg;

    //rri = data[12] | (data[11] << 8);

    //TODO Calculate checksum

    document.getElementById("log").value = "";
    // log('SBP: ' + sbp + ', DBP: ' + dbp + ', RRI: ' + rri);
    // dataLog = dataLog + sbp + ', ' + dbp + ', ' + rri + '\n';
    log('SBP: ' + sbp + ', DBP: ' + dbp);
    dataLog = dataLog + time + ',' + data[2] + ',' + data[5] + ',' + sbp + ',' + dbp + '\n';

    graphProcessed(sbp, dbp);
}

function graphRaw(ppg, ecg) {
    var time = new Date();

    ppg_ts.append(time, ppg);
    ecg_ts.append(time, ecg);
}

function graphProcessed(sbp, dbp) {

    algYvalues[0] = sbp;
    algYvalues[1] = dbp;
    alg_chart.update();
}

async function onDisconnected() {
    log("Bluetooth connection terminated!");
    no_data_yet = true;
}

async function bleDisconnect() {

    createSettings();

    if (device != null) {
        if (device.gatt.connected) {
            log("Disconnecting");
            device.gatt.disconnect();
        }
        else {
            log('> Bluetooth Device is already disconnected');
        }
    }
}

// Scan, connect and explore CodeLess BLE device
async function ble_connect() {
    try {
        // Define a scan filter and prepare for interaction with Codeless Service
        log('Requesting Bluetooth Device...');
        device = await navigator.bluetooth.requestDevice({
            filters: [{ name: 'BPP' }],
            optionalServices: [BPP_SVC_UUID]
        });
        device.addEventListener('gattserverdisconnected', onDisconnected);
        // Connect to device GATT and perform attribute discovery
        server = await device.gatt.connect();
        const service = await server.getPrimaryService(BPP_SVC_UUID);
        const flowcontrolChar = await service.getCharacteristic(RX_CHAR_UUID);
        const txChar = await service.getCharacteristic(TX_CHAR_UUID);

        createSettings();

        txChar.writeValue(settingsArr);
        // Subscribe to notifications
        await flowcontrolChar.startNotifications();
        flowcontrolChar.addEventListener('characteristicvaluechanged', incomingData);
        log('Ready to communicate!\n');

        if (alg_mode == 0) {
            document.getElementById('spinner').style = "display:flex;";
            log('Calculating Blood Pressure...\n');
        }
        else {
            log('Acquiring Raw Data...\n');
        }
    }
    catch (error) {
        log('Failed: ' + error);
    }
}

function createTimeline() {
    document.getElementById('rawchart').width = document.getElementById('stage').clientWidth * 0.95;
    document.getElementById('ecgchart').width = document.getElementById('stage').clientWidth * 0.95;
    document.getElementById('algchart').width = document.getElementById('stage').clientWidth * 0.95;
    //document.getElementById('bpchart').width = document.getElementById('stage').clientWidth * 0.95;

    raw_chart.addTimeSeries(ppg_ts, {
        strokeStyle: 'rgba(128, 0, 128, 1)',
        lineWidth: 2

    });

    ecg_chart.addTimeSeries(ecg_ts, {
        strokeStyle: 'rgba(255, 0, 0, 1)',
        lineWidth: 1
    });

    raw_chart.streamTo(document.getElementById("rawchart"));
    ecg_chart.streamTo(document.getElementById("ecgchart"));
}

function calcChecksum()
{
    var    i   = 0;
    var     bcc = 0;

    for (var i = 0; i < 7; i++ )
    {
        /* cast */
        bcc ^= settingsArr[i]
    }

    settingsArr[7] = bcc;
}

function createSettings() {
    settingsArr[0] = 0x55;
    settingsArr[4] = parseInt(document.getElementById("gender").value, 10);
    settingsArr[6] = parseInt(document.getElementById("mode").value, 10);
    settingsArr[5] = parseInt(document.getElementById("style").value, 10);
    settingsArr[1] = parseInt(document.getElementById("height").value, 10);
    settingsArr[2] = parseInt(document.getElementById("weight").value, 10);
    settingsArr[3] = parseInt(document.getElementById("age").value, 10);

    alg_mode = settingsArr[6];

    calcChecksum();
}

function adjust_width() {
    document.getElementById('rawchart').width = document.getElementById('stage').clientWidth * 0.95;
    document.getElementById('ecgchart').width = document.getElementById('stage').clientWidth * 0.95;
    document.getElementById('algchart').width = document.getElementById('stage').clientWidth * 0.95;
}

function interpolate(val_ppg, val_ecg) {
    var coef_a_ecg, coef_a_ppg, coef_b_ecg,
        coef_b_ppg, val_data_interpolate_ecg, 
        val_data_interpolate_ppg;

    val_data_compare_ppg = val_ppg;
    val_data_compare_ecg = val_ecg;

    if (val_data_compare_ecg !== val_data_compare_last_ecg && g_num_line !== 0) {
        val_line_same_end = g_num_line;
        val_data_same_end_ppg = val_data_compare_ppg;
        val_data_same_end_ecg = val_data_compare_ecg;
        coef_a_ppg = (val_data_same_start_ppg - val_data_same_end_ppg) / (val_line_same_start - val_line_same_end);
        coef_a_ecg = (val_data_same_start_ecg - val_data_same_end_ecg) / (val_line_same_start - val_line_same_end);
        coef_b_ppg = -1 * coef_a_ppg * val_line_same_start + val_data_same_start_ppg;
        coef_b_ecg = -1 * coef_a_ecg * val_line_same_start + val_data_same_start_ecg;

        for (var x = val_line_same_start, _pj_a = val_line_same_end; x < _pj_a; x += 1) {
            val_data_interpolate_ppg = coef_a_ppg * x + coef_b_ppg;
            val_data_interpolate_ecg = coef_a_ecg * x + coef_b_ecg;

            graphRaw(val_data_interpolate_ppg, val_data_interpolate_ecg);
        }

        val_line_same_start = g_num_line;
        val_data_same_start_ppg = val_data_compare_ppg;
        val_data_same_start_ecg = val_data_compare_ecg;
    }
    g_num_line += 1;
    val_data_compare_last_ppg = val_data_compare_ppg;
    val_data_compare_last_ecg = val_data_compare_ecg;

}

function save(filename, data) {
    
    if (alg_mode == 1) {
        filename += '_raw_';
    }
    else {
        filename += '_processed_';
    }
    filename += formatDate(new Date(), "yyyyMMdd_HHmmss");
    filename += '.csv';
    if (document.getElementById('savebutton').value == 'Save') {
        document.getElementById('savebutton').value = 'Saving';
        document.getElementById("savebutton").classList.remove('button3');
        document.getElementById("savebutton").classList.add('button3_on');
        dataLog = "";

        if (alg_mode == 1) {
            dataLog = "ppg,ecg\n";
        }
        else {
            dataLog = "time,sbp,dbp,sbp-avg,dbp-avg\n";
        }
    }
    else {
        document.getElementById('savebutton').value = 'Save';
        document.getElementById("savebutton").classList.remove('button3_on');
        document.getElementById("savebutton").classList.add('button3');

        //     data = csvHeader + data;
        const blob = new Blob([data], { type: 'text/csv' });
        if (window.navigator.msSaveOrOpenBlob) {
            window.navigator.msSaveBlob(blob, filename);
        }
        else {
            const elem = window.document.createElement('a');
            elem.href = window.URL.createObjectURL(blob);
            elem.download = filename;
            document.body.appendChild(elem);
            elem.click();
            document.body.removeChild(elem);
        }
    }
}

var DBP_AVGS = 4;
var DBP_buffer = new Float32Array(DBP_AVGS);
var DBP_int_buffer = new Int16Array(DBP_AVGS);
var DBP_buffer_ind = 0;
var num_DBPs = 0;
function get_avg_DBP(new_DBP)
{ //simple mean. Resets when passed a zero.
	
	var new_avg = 0;
	var int_avg = 0;
	var bits_of_prec = 12; //bits of precision
	var rms = 0;
	var new_ind;
    var DBP_rms = 0;

	if (new_DBP > 0)
	{ //>0 valid, do average
		num_DBPs++; //increment number to average
		if (num_DBPs > DBP_AVGS) num_DBPs = DBP_AVGS; //truncate number of averages at max value
		DBP_buffer[DBP_buffer_ind] = new_DBP; //load new sample into buffer
		DBP_int_buffer[DBP_buffer_ind] = new_DBP * (2 ** bits_of_prec);
		new_ind = DBP_buffer_ind; //get index of current latest sample

		DBP_buffer_ind++; //increment buffer pointer for next time
		if (DBP_buffer_ind == DBP_AVGS)
			DBP_buffer_ind = 0; //loop back

		for (var n = 0; n < num_DBPs; n++)
		{
			new_avg += DBP_buffer[new_ind]; //add each previous PI value
			int_avg += DBP_int_buffer[new_ind];
			new_ind--; //decrement pointer
			if (new_ind < 0)
				new_ind += DBP_AVGS; //loop back
		}
		new_avg /= num_DBPs;
		int_avg /= num_DBPs;
		new_ind = DBP_buffer_ind - 1;
		if (new_ind < 0)
			new_ind += DBP_AVGS; //loop back
		for (var n = 0; n < num_DBPs; n++)
		{
			rms += ((DBP_int_buffer[new_ind] - int_avg)
					* (DBP_int_buffer[new_ind] - int_avg));
			new_ind--;
			if (new_ind < 0)
				new_ind += DBP_AVGS;
		}
		rms /= num_DBPs; //divide by number of samples
		rms = Math.sqrt(rms); //square root
		DBP_rms = rms * (2 ** (-bits_of_prec)); //convert back to float
	}
	else
	{ //reset
		new_avg = new_DBP;
		num_DBPs = 0;
		DBP_buffer_ind = 0;
		DBP_rms = 0;
	}

	return {
        'avg': Math.round(new_avg),
        'rms': DBP_rms
    };
}

var SBP_AVGS = 4;
var SBP_buffer = new Float32Array(SBP_AVGS);
var SBP_int_buffer = new Int16Array(SBP_AVGS);
var SBP_buffer_ind = 0;
var num_SBPs = 0;
function get_avg_SBP(new_SBP) { //simple mean. Resets when passed a zero.

    var new_avg = 0;
    var int_avg = 0;
    var bits_of_prec = 12; //bits of precision
    var rms = 0;
    var new_ind;
    var SBP_rms = 0;

    if (new_SBP > 0) { //>0 valid, do average
        num_SBPs++; //increment number to average
        if (num_SBPs > SBP_AVGS) num_SBPs = SBP_AVGS; //truncate number of averages at max value
        SBP_buffer[SBP_buffer_ind] = new_SBP; //load new sample into buffer
        SBP_int_buffer[SBP_buffer_ind] = new_SBP * (2 ** bits_of_prec);
        new_ind = SBP_buffer_ind; //get index of current latest sample

        SBP_buffer_ind++; //increment buffer pointer for next time
        if (SBP_buffer_ind == SBP_AVGS)
            SBP_buffer_ind = 0; //loop back

        for (var n = 0; n < num_SBPs; n++) {
            new_avg += SBP_buffer[new_ind]; //add each previous PI value
            int_avg += SBP_int_buffer[new_ind];
            new_ind--; //decrement pointer
            if (new_ind < 0)
                new_ind += SBP_AVGS; //loop back
        }
        new_avg /= num_SBPs;
        int_avg /= num_SBPs;
        new_ind = SBP_buffer_ind - 1;
        if (new_ind < 0)
            new_ind += SBP_AVGS; //loop back
        for (var n = 0; n < num_SBPs; n++) {
            rms += ((SBP_int_buffer[new_ind] - int_avg)
                * (SBP_int_buffer[new_ind] - int_avg));
            new_ind--;
            if (new_ind < 0)
                new_ind += SBP_AVGS;
        }
        rms /= num_SBPs; //divide by number of samples
        rms = Math.sqrt(rms); //square root
        SBP_rms = rms * (2 ** (-bits_of_prec)); //convert back to float
    }
    else { //reset
        new_avg = new_SBP;
        num_SBPs = 0;
        SBP_buffer_ind = 0;
        SBP_rms = 0;
    }

    return {
        'avg': Math.round(new_avg),
        'rms': SBP_rms
    };
}

function formatDate(date, format, utc) {
    var MMMM = ["\x00", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    var MMM = ["\x01", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var dddd = ["\x02", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    var ddd = ["\x03", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    function ii(i, len) {
        var s = i + "";
        len = len || 2;
        while (s.length < len) s = "0" + s;
        return s;
    }

    var y = utc ? date.getUTCFullYear() : date.getFullYear();
    format = format.replace(/(^|[^\\])yyyy+/g, "$1" + y);
    format = format.replace(/(^|[^\\])yy/g, "$1" + y.toString().substr(2, 2));
    format = format.replace(/(^|[^\\])y/g, "$1" + y);

    var M = (utc ? date.getUTCMonth() : date.getMonth()) + 1;
    format = format.replace(/(^|[^\\])MMMM+/g, "$1" + MMMM[0]);
    format = format.replace(/(^|[^\\])MMM/g, "$1" + MMM[0]);
    format = format.replace(/(^|[^\\])MM/g, "$1" + ii(M));
    format = format.replace(/(^|[^\\])M/g, "$1" + M);

    var d = utc ? date.getUTCDate() : date.getDate();
    format = format.replace(/(^|[^\\])dddd+/g, "$1" + dddd[0]);
    format = format.replace(/(^|[^\\])ddd/g, "$1" + ddd[0]);
    format = format.replace(/(^|[^\\])dd/g, "$1" + ii(d));
    format = format.replace(/(^|[^\\])d/g, "$1" + d);

    var H = utc ? date.getUTCHours() : date.getHours();
    format = format.replace(/(^|[^\\])HH+/g, "$1" + ii(H));
    format = format.replace(/(^|[^\\])H/g, "$1" + H);

    var h = H > 12 ? H - 12 : H == 0 ? 12 : H;
    format = format.replace(/(^|[^\\])hh+/g, "$1" + ii(h));
    format = format.replace(/(^|[^\\])h/g, "$1" + h);

    var m = utc ? date.getUTCMinutes() : date.getMinutes();
    format = format.replace(/(^|[^\\])mm+/g, "$1" + ii(m));
    format = format.replace(/(^|[^\\])m/g, "$1" + m);

    var s = utc ? date.getUTCSeconds() : date.getSeconds();
    format = format.replace(/(^|[^\\])ss+/g, "$1" + ii(s));
    format = format.replace(/(^|[^\\])s/g, "$1" + s);

    var f = utc ? date.getUTCMilliseconds() : date.getMilliseconds();
    format = format.replace(/(^|[^\\])fff+/g, "$1" + ii(f, 3));
    f = Math.round(f / 10);
    format = format.replace(/(^|[^\\])ff/g, "$1" + ii(f));
    f = Math.round(f / 10);
    format = format.replace(/(^|[^\\])f/g, "$1" + f);

    var T = H < 12 ? "AM" : "PM";
    format = format.replace(/(^|[^\\])TT+/g, "$1" + T);
    format = format.replace(/(^|[^\\])T/g, "$1" + T.charAt(0));

    var t = T.toLowerCase();
    format = format.replace(/(^|[^\\])tt+/g, "$1" + t);
    format = format.replace(/(^|[^\\])t/g, "$1" + t.charAt(0));

    var tz = -date.getTimezoneOffset();
    var K = utc || !tz ? "Z" : tz > 0 ? "+" : "-";
    if (!utc) {
        tz = Math.abs(tz);
        var tzHrs = Math.floor(tz / 60);
        var tzMin = tz % 60;
        K += ii(tzHrs) + ":" + ii(tzMin);
    }
    format = format.replace(/(^|[^\\])K/g, "$1" + K);

    var day = (utc ? date.getUTCDay() : date.getDay()) + 1;
    format = format.replace(new RegExp(dddd[0], "g"), dddd[day]);
    format = format.replace(new RegExp(ddd[0], "g"), ddd[day]);

    format = format.replace(new RegExp(MMMM[0], "g"), MMMM[M]);
    format = format.replace(new RegExp(MMM[0], "g"), MMM[M]);

    format = format.replace(/\\(.)/g, "$1");

    return format;
};
