const socket = io();

function generateRoomId() {
  return Math.random().toString(36).substring(2, 10);
}

function initSender() {
  const fileInput = document.getElementById("fileInput");
  const linkDisplay = document.getElementById("link");
  const startBtn = document.getElementById("startBtn");

  const roomId = generateRoomId();

  startBtn.addEventListener("click", () => {
    if (!fileInput.files.length) {
      alert("Please select files first.");
      return;
    }

    const files = Array.from(fileInput.files);
    const filesToSend = [];
    let filesRead = 0;

    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        filesToSend.push({
          fileName: file.name,
          fileBuffer: reader.result
        });

        filesRead++;
        if (filesRead === files.length) {
          socket.emit('multi-file-upload', { roomId, files: filesToSend });
          window.open(`/qr.html?id=${roomId}`);
        }
      };
      reader.readAsArrayBuffer(file);
    });
  });
}

function initReceiver() {
  const urlParams = new URLSearchParams(window.location.search);
  const roomId = urlParams.get('id');
  if (!roomId) return;

  socket.emit('join', roomId);

  socket.on('ready-to-download', () => {
    socket.emit('request-multi-file', roomId);
  });

  socket.on('multi-file-data', (files) => {
    if (!files.length) {
      const downloadList = document.getElementById('downloadList');
      downloadList.innerHTML = 'No files available.';
      return;
    }

    // Build batch as array of { filename, blob }
    const batchFiles = files.map(({ fileName, fileBuffer }) => {
      return {
        filename: fileName,
        blob: new Blob([fileBuffer])
      };
    });

    // Add files as a batch (creates one card)
    addDownloadBatch(batchFiles);
  });
}
