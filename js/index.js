const BITRATES = [2, 6, 10, 16, 32, 64, 96, 128, 192, 512].reverse();

const AUDIO_FOLDER_URL = 'audio/';
const AUDIO_LOOP_START_MS = 1;

initDropdown();

function showError(error) {
  console.error(error); // Stampa l'errore nella console per il debug

  const status = document.querySelector('#status');
  if (status) {
    status.classList.add('error');
    status.innerText = 'ERROR: ' + error.message;
  } else {
    alert('ERROR: ' + error.message); // Fallback se l'elemento #status non è presente
  }
}

function showWarning(msg) {
  document.querySelector('#warning').innerText = `⚠️ ${msg}`;
}

async function initDropdown() {
  const dropdown = document.createElement('select');
  dropdown.id = 'folderSelect';

  try {
    const folders = await fetchFolders();
    folders.forEach(folder => {
      const option = document.createElement('option');
      option.value = folder;
      option.text = folder;
      dropdown.appendChild(option);
    });

    const dropdownWrapper = document.createElement('div');
    dropdownWrapper.id = 'dropdownWrapper';
    dropdownWrapper.appendChild(dropdown);
    document.body.prepend(dropdownWrapper);

    // Aggiunge l'evento per caricare i file al cambio di cartella
    dropdown.addEventListener('change', () => {
      const selectedFolder = dropdown.value;
      init(BITRATES, selectedFolder);
    });

    // Inizializza con la prima cartella
    if (folders.length > 0) {
      init(BITRATES, folders[0]);
    } else {
      showError(new Error('No folders found'));
    }
  } catch (err) {
    showError(err);
  }
}

async function fetchFolders() {
  const response = await fetch(`${AUDIO_FOLDER_URL}folders`);
  if (!response.ok) {
    throw new Error('Failed to fetch folders');
  }
  return response.json(); // Assume the server returns a JSON array of folder names
}

async function init(bitrates, folder) {
  if (/android.*chrome/i.test(navigator.userAgent)) {
    showWarning('Playback problems occur in Chrome 85 and below on Android. These may still exist in newer versions.');
  }
  if (!window.AudioWorklet) {
    return showError(Error('This browser does not support Audio Worklets. Please try a different browser.'));
  }

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
  audioCtx.suspend();

  const [{ files, buffers }, workletNode] = await Promise.all([
    fetchAndDecode(bitrates, audioCtx, folder),
    initAudioWorklet(audioCtx),
  ]).catch(showError);

  workletNode.port.postMessage({ init: files }, buffers);

  setTimeout(() => initDOM(files, audioCtx, workletNode), 500);
}

async function fetchAndDecode(bitrates, audio, folder) {
  const buffers = [];
  const files = await Promise.all(bitrates.map(async bitrate => {
    const origResponse = await fetch(`${AUDIO_FOLDER_URL}/${folder}/${bitrate}.webm`);
    const response = downloadProgressResponse(origResponse);
    const fileSize = response.headers.get('content-length');
    const audioBuffer = await audio.decodeAudioData(await response.arrayBuffer());
    const pcmLeft = audioBuffer.getChannelData(0);
    const pcmRight = audioBuffer.numberOfChannels > 1
      ? audioBuffer.getChannelData(1)
      : pcmLeft;

    buffers.push(pcmLeft.slice().buffer, pcmRight.slice().buffer);
    return { bitrate, fileSize, pcmLeft, pcmRight };
  }));

  return { files, buffers };
}

function initDOM(files, audioCtx, workletNode) {
  const btnPause = document.querySelector('#pause');
  btnPause.onclick = pause;

  const wrapper = document.querySelector('.bitrates');
  const buttons = files.map((file, i) => {
    const btn = document.createElement('button');
    btn.addEventListener('mousedown', () => playBitrate(btn, file, i));
    btn.innerHTML = `<div class="bitrate">${file.bitrate}</div>kbit/s<div class="file-size">${fileSize(file.fileSize)}</div>`;
    return btn;
  });

  wrapper.innerHTML = '';
  wrapper.append(...buttons);

  function fileSize(size) {
    const kb = size / 1024;
    return `${kb.toLocaleString(navigator.language, { maximumFractionDigits: 1 })} KiB`;
  }

  function pause() {
    audioCtx.suspend();
    btnPause.hidden = true;
    resetButtons();
  }

  function resetButtons() {
    buttons.forEach(btn => btn.classList.remove('active'));
  }

  function playBitrate(button, file, index) {
    const srcParam = workletNode.parameters.get('audioSrcIndex');
    srcParam.setValueAtTime(index, audioCtx.currentTime);
    audioCtx.resume();

    resetButtons();
    button.classList.add('active');

    btnPause.hidden = false;
  }
}

async function initAudioWorklet(audioCtx) {
  await audioCtx.audioWorklet.addModule('js/worklet-bitrate-switcher.js?' + Date.now());

  const workletNode = new AudioWorkletNode(audioCtx, 'bitrate-switcher', {
    outputChannelCount: [2], // stereo
    processorOptions: {
      loopStartMs: AUDIO_LOOP_START_MS, // optional. Milliseconds to start the loop (if music has an intro)
    },
  });
  workletNode.connect(audioCtx.destination);
  return workletNode;
}

function downloadProgressResponse(response) {
  if (!response.ok) {
    throw Error(response.status + ' ' + response.statusText);
  }

  if (!response.body) {
    throw Error('ReadableStream not yet supported in this browser.');
  }

  const contentEncoding = response.headers.get('content-encoding');
  const contentLength = response.headers.get(contentEncoding ? 'x-file-size' : 'content-length');
  if (contentLength === null) {
    throw Error('Response size header unavailable');
  }

  const total = parseInt(contentLength, 10);
  let bytesDownloaded = 0;

  ProgressManager.register(total);

  return new Response(
    new ReadableStream({
      start(controller) {
        const reader = response.body.getReader();

        read();

        function read() {
          reader.read().then(({ done, value }) => {
            if (done) {
              controller.close();
              return;
            }
            bytesDownloaded += value.byteLength;
            ProgressManager.report({ bytesDownloaded });
            controller.enqueue(value);
            read();
          }).catch(error => {
            console.error(error);
            controller.error(error);
          });
        }
      },
    }),
    {
      headers: new Headers(response.headers),
    }
  );
}

const ProgressManager = (function () {
  const downloadWeight = 0.8;
  const decoderWeight = 1 - downloadWeight;

  const elProgress = document.querySelector('#loading');
  let totalToDownload = 0;
  let totalDownloaded = 0;
  let totalFiles = BITRATES.length;
  let totalFilesRegistered = 0;
  let totalDecoded = 0;
  let lastTotalProgress = 0;

  function register(fileSize) {
    totalToDownload += fileSize;
    totalFilesRegistered++;
    updateUI();
  }

  function report({ bytesDownloaded, decoded }) {
    totalDownloaded += bytesDownloaded || 0;
    totalDecoded += decoded || 0;
    updateUI();
  }

  function updateUI() {
    const registeredDownloadsWeight = totalFilesRegistered / totalFiles;

    const downloadProgress = (totalDownloaded / totalToDownload) * downloadWeight;
    const decodeProgress = (totalDecoded / totalFiles) * decoderWeight;
    const totalProgress = (downloadProgress + decodeProgress) * registeredDownloadsWeight;

    if (totalProgress < lastTotalProgress) return;

    lastTotalProgress = totalProgress;

    requestAnimationFrame(() => {
      elProgress.innerText = Math.floor(totalProgress * 100) + ' %';
    });
  }

  return {
    register,
    report,
  };
})();
