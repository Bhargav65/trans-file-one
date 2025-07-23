// public/app.js

// Crypto polyfill for older browsers
if (!crypto.randomUUID) {
    crypto.randomUUID = function() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    };
}

class SecureShare {
    constructor() {
        this.socket = io();
        this.currentRoom = null;
        this.isHost = false;
        this.files = new Map();
        this.chunkSize = 1024 * 1024;
        this.activeDownload = null;
        this.participantCount = 0;
        this.intentionalNavigation = false;
        this.sessionActive = false;
        this.pendingHostLeave = false; // Track if host leave is pending
        
        this.setupRefreshHandler();
        this.initializeEventListeners();
        this.setupSocketHandlers();
        this.checkPageRefresh();
        this.handleURLParameters();
    }
    
    // Check if page was refreshed and handle accordingly
    checkPageRefresh() {
        const wasRefreshed = performance.getEntriesByType('navigation')[0]?.type === 'reload' ||
                           performance.navigation?.type === 1;
        
        const urlRoomCode = this.getRoomCodeFromURL();
        
        if (wasRefreshed && urlRoomCode) {
            //console.log('Page refresh detected while in room. Redirecting to home.');
            
            setTimeout(() => {
                this.showStatus('Session was lost due to page refresh.\n\nRedirecting to home page...', 'info');
                this.redirectToHome();
            }, 500);
            
            return true;
        }
        
        return false;
    }
    
    // Clean redirect to home
    redirectToHome() {
        this.intentionalNavigation = true;
        this.sessionActive = false;
        
        if (this.socket.connected) {
            this.socket.disconnect();
        }
        
        this.currentRoom = null;
        this.isHost = false;
        this.participantCount = 0;
        
        window.location.href = '/';
    }
    
    // Enhanced refresh handler with host-specific behavior
    setupRefreshHandler() {
        window.addEventListener('beforeunload', (e) => {
            if (this.sessionActive && !this.intentionalNavigation && !this.pendingHostLeave) {
                const message = this.isHost ? 
                    'Refreshing will close the room for all participants. Changes will not be saved.' :
                    'Changes will not be saved. Are you sure you want to leave?';
                
                this.sessionActive = false;
                
                e.preventDefault();
                e.returnValue = message;
                return message;
            }
        });
        
        window.addEventListener('pageshow', (e) => {
            if (e.persisted && !this.sessionActive) {
                this.redirectToHome();
            }
        });
    }
    
    handleURLParameters() {
        if (this.checkPageRefresh()) {
            return;
        }
        
        const roomCode = this.getRoomCodeFromURL();
        
        if (roomCode) {
            this.attemptRoomJoin(roomCode);
        } else {
            this.showInitialScreen();
        }
    }
    
    getRoomCodeFromURL() {
        const urlParams = window.location.pathname.split('/');
        const roomCode = urlParams[1];
        return (roomCode && roomCode.length === 6) ? roomCode.toUpperCase() : null;
    }
    
    attemptRoomJoin(roomCode) {
        this.currentRoom = roomCode;
        this.socket.emit('join-room', roomCode);
    }
    
    showInitialScreen() {
        document.getElementById('sharing-screen').classList.add('hidden');
        document.getElementById('initial-screen').classList.remove('hidden');
        document.getElementById('join-form').classList.add('hidden');
        
        this.currentRoom = null;
        this.isHost = false;
        this.participantCount = 0;
        this.intentionalNavigation = false;
        this.sessionActive = false;
        this.pendingHostLeave = false;
    }
    
    initializeEventListeners() {
        const dropZone = document.getElementById('drop-zone');
        const fileInput = document.getElementById('file-input');
        const roomInput = document.getElementById('room-code-input');
        
        // Drag and drop handlers
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });
        
        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('dragover');
        });
        
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            this.handleFiles(e.dataTransfer.files);
        });
        
        // dropZone.addEventListener('click', () => {
        //     fileInput.click();
        // });
        
        fileInput.addEventListener('change', (e) => {
            this.handleFiles(e.target.files);
        });
        
        // Room input handlers
        roomInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.joinRoom();
            }
        });
        
        roomInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.toUpperCase();
        });
        
        // Popup handlers
        document.addEventListener('click', (e) => {
            const sharePopup = document.getElementById('share-popup');
            if (e.target === sharePopup) {
                this.closeSharePopup();
            }
        });
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeSharePopup();
            }
        });
    }
    
    setupSocketHandlers() {
        this.socket.on('room-created', (data) => {
             const hostHTML = `
        <div class="host-indicator" style="
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: -1;
            padding: 8px;
        ">
            <video src="/aLIRd8xjlb.webm" 
                   autoplay loop muted playsinline 
                   style="display: block; border-radius: 8px; max-width: 80px; height: auto;">
            </video>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', hostHTML);
            this.currentRoom = data.roomCode;
            this.isHost = data.isHost;
            this.participantCount = data.participantCount || 1;
            this.sessionActive = true;
            this.showSharingScreen(data.roomCode);
            this.showStatus('Room created successfully! Share the code with others.', 'success');
        });
        
        this.socket.on('room-joined', (data) => {
            this.currentRoom = data.roomCode;
            this.isHost = data.isHost;
            this.participantCount = data.participantCount || 1;
            this.sessionActive = true;
            this.showSharingScreen(data.roomCode);
            this.displayExistingFiles(data.files);
            this.showStatus(this.isHost ? 'Reconnected to your room successfully!' : 'Joined room successfully!', 'success');
        });
        
        // Handle host leave confirmation request
        this.socket.on('host-leave-confirmation', (data) => {
            this.pendingHostLeave = true;
            
            const participantText = data.participantCount === 0 ? 
                'You are the only one in the room.' :
                data.participantCount === 1 ?
                    'There is 1 other participant in the room.' :
                    `There are ${data.participantCount} other participants in the room.`;
            
            const confirmed = confirm(
                `Do you want to really leave this page?`
            );
            
            if (confirmed) {
                this.socket.emit('host-leave-confirmed', this.currentRoom);
                this.sessionActive = false;
                this.intentionalNavigation = true;
                
                setTimeout(() => {
                    this.redirectToHome();
                }, 100);
            }
            
            this.pendingHostLeave = false;
        });
        
        this.socket.on('participant-count-updated', (data) => {
            //console.log(`Participant count updated: ${data.count}`);
            this.participantCount = data.count;
            this.updateParticipantCount();
        });
        
        this.socket.on('participant-joined', (socketId) => {
        
            //console.log(`Participant ${socketId} joined`);
        });
        
        this.socket.on('participant-left', (socketId) => {
            //console.log(`Participant ${socketId} left`);
        });
        
        // Handle status messages from server
        this.socket.on('status-message', (data) => {
             this.showStatus(data.message, data.type);
         });
        
        this.socket.on('room-not-found', () => {
            this.showStatus('Room not found. Redirecting to home...', 'error');
            setTimeout(() => {
                this.redirectToHome();
            }, 2000);
        });
        
        this.socket.on('room-invalid', () => {
            this.showStatus('This room no longer exists. Redirecting to home...', 'error');
            setTimeout(() => {
                this.redirectToHome();
            }, 2000);
        });
        
        // Handle when host closes room
        this.socket.on('room-closed-by-host', () => {
            this.showStatus('Room has been closed by the host. Redirecting...', 'error');
            
            this.sessionActive = false;
            this.currentRoom = null;
            this.isHost = false;
            this.participantCount = 0;
            this.files.clear();
            this.activeDownload = null;
            
            const fileList = document.getElementById('file-list');
            if (fileList) fileList.innerHTML = '';
            
            setTimeout(() => {
                this.redirectToHome();
            }, 1500);
        });
        
        this.socket.on('file-available', (fileData) => {
            this.displayFileItem(fileData);
        });
        
        this.socket.on('chunk-available', (data) => {
            this.updateUploadProgress(data.fileId, data.progress);
        });
        
        this.socket.on('file-info', (data) => {
            if (this.activeDownload && this.activeDownload.fileId === data.fileId) {
                this.activeDownload.totalChunks = data.totalChunks;
                this.activeDownload.fileName = data.name;
                this.requestNextChunk();
            }
        });
        
        this.socket.on('chunk-data', (data) => {
            this.handleReceivedChunk(data);
        });
        
        this.socket.on('connect', () => {
          //  console.log('Connected to server');
            this.intentionalNavigation = false;
        });
        
        this.socket.on('disconnect', (reason) => {
         //   console.log('Disconnected from server:', reason);
            if (this.sessionActive && !this.intentionalNavigation) {
                this.showStatus('Connection lost. Trying to reconnect...', 'error');
            }
        });
        
        this.socket.on('reconnect', () => {
           // console.log('Reconnected to server');
            
            if (this.sessionActive && this.currentRoom) {
            //    console.log(`Attempting to rejoin room: ${this.currentRoom}`);
                this.socket.emit('join-room', this.currentRoom);
                this.showStatus('Reconnected successfully!', 'success');
            } else {
             //   console.log('Reconnected but no active session. Redirecting to home.');
                this.redirectToHome();
            }
        });
    }
    
    createRoom() {
        this.socket.emit('create-room');
    }
    
    joinRoom() {
        const roomCode = document.getElementById('room-code-input').value.trim().toUpperCase();
        if (roomCode.length === 6) {
            this.intentionalNavigation = true;
            window.location.href = `/${roomCode}`;
        } else {
            this.showStatus('Please enter a valid 6-character code.', 'error');
        }
    }
    
    showSharingScreen(roomCode) {
        this.intentionalNavigation = false;
        
        document.getElementById('initial-screen').classList.add('hidden');
        document.getElementById('sharing-screen').classList.remove('hidden');
        
        const codeSpan = document.getElementById('room-code-value');
        if (codeSpan) codeSpan.textContent = roomCode;
        
        this.updateParticipantCount();
        
        if (window.location.pathname !== `/${roomCode}`) {
            window.history.pushState({}, '', `/${roomCode}`);
        }
    }
    
    showJoinForm() {
        const joinForm = document.getElementById('join-form');
        const roomInput = document.getElementById('room-code-input');
        
        if (joinForm) {
            joinForm.classList.remove('hidden');
            if (roomInput) {
                roomInput.focus();
            }
        }
    }
    
    // Enhanced switchToJoinMode - handles both host and participant scenarios
    switchToJoinMode() {
        if (this.currentRoom) {
            if (this.isHost) {
                // Host wants to join different room - trigger confirmation
                this.socket.emit('host-leave-request', this.currentRoom);
                return; // Wait for confirmation dialog
            } else {
                // Regular participant leaving
                this.intentionalNavigation = true;
                this.sessionActive = false;
                this.socket.emit('leave-room', this.currentRoom);
                
                setTimeout(() => {
                    window.location.href = '/';
                }, 100);
            }
        } else {
            // No current room, just navigate
            this.intentionalNavigation = true;
            window.location.href = '/';
        }
    }
    
    updateParticipantCount() {
        const countElement = document.getElementById('participants-count');
        if (countElement) {
            const text = this.participantCount === 1 ? 
                '1 participant connected' : 
                `${this.participantCount} participants connected`;
            countElement.textContent = text;
        }
    }
    
    showSharePopup() {
        if (!this.currentRoom) return;
        
        const popup = document.getElementById('share-popup');
        const shareLink = `${window.location.origin}/${this.currentRoom}`;
        const shareLinkInput = document.getElementById('share-link-input');
        
        shareLinkInput.value = shareLink;
        this.generateQRCode(shareLink);
        
        popup.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }
    
    closeSharePopup() {
        const popup = document.getElementById('share-popup');
        popup.classList.add('hidden');
        document.body.style.overflow = '';
    }
    
    generateQRCode(text) {
        const qrContainer = document.getElementById('qr-code');
        qrContainer.innerHTML = '';
        
        try {
            const qr = qrcode(0, 'M');
            qr.addData(text);
            qr.make();
            
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            const modules = qr.getModuleCount();
            const cellSize = 200 / modules;
            canvas.width = 200;
            canvas.height = 200;
            
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, 200, 200);
            
            ctx.fillStyle = '#105652';
            for (let row = 0; row < modules; row++) {
                for (let col = 0; col < modules; col++) {
                    if (qr.isDark(row, col)) {
                        ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
                    }
                }
            }
            
            qrContainer.appendChild(canvas);
            
        } catch (error) {
         //   console.error('QR Code generation failed:', error);
            qrContainer.innerHTML = '<div style="width: 200px; height: 200px; display: flex; align-items: center; justify-content: center; background: #f0f0f0; border-radius: 8px; color: #666;">QR Code Error</div>';
        }
    }
    
    async copyShareLink() {
        const shareLinkInput = document.getElementById('share-link-input');
        const copyButton = document.querySelector('.copy-button');
        
        try {
            await navigator.clipboard.writeText(shareLinkInput.value);
            
            copyButton.textContent = 'Copied!';
            copyButton.classList.add('copied');
            
            setTimeout(() => {
                copyButton.textContent = 'Copy Link';
                copyButton.classList.remove('copied');
            }, 2000);
            
            this.showStatus('Link copied to clipboard!', 'success');
        } catch (err) {
            shareLinkInput.select();
            shareLinkInput.setSelectionRange(0, 99999);
            document.execCommand('copy');
            
            copyButton.textContent = 'Copied!';
            copyButton.classList.add('copied');
            
            setTimeout(() => {
                copyButton.textContent = 'Copy Link';
                copyButton.classList.remove('copied');
            }, 2000);
            
            this.showStatus('Link copied to clipboard!', 'success');
        }
    }
    
    async handleFiles(files) {
        for (let file of files) {
            if (file.size > 5 * 1024 * 1024 * 1024) {
                this.showStatus(`File ${file.name} is too large (max 5GB)`, 'error');
                continue;
            }
            
            await this.shareFile(file);
        }
    }
    
    async shareFile(file) {
        const fileId = crypto.randomUUID();
        const fileInfo = {
            id: fileId,
            name: file.name,
            size: file.size,
            type: file.type
        };
        
        this.socket.emit('share-file', {
            roomCode: this.currentRoom,
            fileInfo: fileInfo
        });
        
        await this.uploadFileInChunks(file, fileId);
    }
    
    async uploadFileInChunks(file, fileId) {
        const totalChunks = Math.ceil(file.size / this.chunkSize);
        
        for (let i = 0; i < totalChunks; i++) {
            const start = i * this.chunkSize;
            const end = Math.min(start + this.chunkSize, file.size);
            const chunk = file.slice(start, end);
            
            const chunkData = await this.fileToBase64(chunk);
            
            this.socket.emit('file-chunk', {
                roomCode: this.currentRoom,
                fileId: fileId,
                chunkIndex: i,
                chunkData: chunkData,
                isLast: i === totalChunks - 1
            });
            
            const progress = (i + 1) / totalChunks;
            this.updateUploadProgress(fileId, progress);
            
            if (i % 5 === 0 && i > 0) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }
    }
    
    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = error => reject(error);
        });
    }
    
    displayFileItem(fileData) {
        const fileList = document.getElementById('file-list');
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        fileItem.id = `file-${fileData.id}`;
        
        const isOwnFile = fileData.senderId === this.socket.id;
        
        fileItem.innerHTML = `
            <div class="file-icon">
                <svg fill="#000000" viewBox="0 0 32 32">
                    <path d="M15.331 6H8.5v20h15V14.154h-8.169z"/>
                    <path d="M18.153 6h-.009v5.342H23.5v-.002z"/>
                </svg>
            </div>
            <div class="file-info">
                <div class="file-name">${fileData.name}</div>
                <div class="file-size">${this.formatFileSize(fileData.size)}</div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: 0%"></div>
                </div>
            </div>
            ${!isOwnFile ? `<button class="download-btn" onclick="app.downloadFile('${fileData.id}', '${fileData.name}')">Download</button>` : ''}
        `;
        
        fileList.appendChild(fileItem);
    }
    
    async downloadFile(fileId, fileName) {
        const fileItem = document.getElementById(`file-${fileId}`);
        const downloadBtn = fileItem.querySelector('.download-btn');
        downloadBtn.textContent = 'Starting...';
        downloadBtn.disabled = true;
        
        this.activeDownload = {
            fileId: fileId,
            fileName: fileName,
            chunks: new Map(),
            totalChunks: 0,
            receivedChunks: 0,
            nextChunkIndex: 0
        };
        
        this.socket.emit('request-file-info', {
            roomCode: this.currentRoom,
            fileId: fileId
        });
    }
    
    requestNextChunk() {
        if (!this.activeDownload) return;
        
        const download = this.activeDownload;
        if (download.nextChunkIndex < download.totalChunks) {
            this.socket.emit('request-chunk', {
                roomCode: this.currentRoom,
                fileId: download.fileId,
                chunkIndex: download.nextChunkIndex
            });
            download.nextChunkIndex++;
        }
    }
    
    handleReceivedChunk(data) {
        const download = this.activeDownload;
        if (!download || download.fileId !== data.fileId) return;
        
        download.chunks.set(data.chunkIndex, data.data);
        download.receivedChunks++;
        
        const progress = download.receivedChunks / download.totalChunks;
        this.updateDownloadProgress(data.fileId, progress);
        
        this.requestNextChunk();
        
        if (download.receivedChunks === download.totalChunks) {
            this.assembleAndDownloadFile(download);
        }
    }
    
    assembleAndDownloadFile(download) {
        try {
            const sortedChunks = Array.from(download.chunks.entries())
                .sort(([a], [b]) => a - b)
                .map(([_, chunkData]) => chunkData);
            
            const binaryChunks = sortedChunks.map(chunk => {
                const binaryString = atob(chunk);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                return bytes;
            });
            
            const totalLength = binaryChunks.reduce((sum, chunk) => sum + chunk.length, 0);
            const combinedArray = new Uint8Array(totalLength);
            let offset = 0;
            
            binaryChunks.forEach(chunk => {
                combinedArray.set(chunk, offset);
                offset += chunk.length;
            });
            
            const blob = new Blob([combinedArray]);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = download.fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            URL.revokeObjectURL(url);
            this.activeDownload = null;
            
            this.showStatus(`File "${download.fileName}" downloaded successfully!`, 'success');
            
        } catch (error) {
            //console.error('Error assembling file:', error);
            this.showStatus('Error downloading file. Please try again.', 'error');
            this.activeDownload = null;
        }
    }
    
    updateUploadProgress(fileId, progress) {
        const fileItem = document.getElementById(`file-${fileId}`);
        if (fileItem) {
            const progressFill = fileItem.querySelector('.progress-fill');
            progressFill.style.width = `${Math.min(progress * 100, 100)}%`;
        }
    }
    
    updateDownloadProgress(fileId, progress) {
        const fileItem = document.getElementById(`file-${fileId}`);
        if (fileItem) {
            const progressFill = fileItem.querySelector('.progress-fill');
            progressFill.style.width = `${Math.min(progress * 100, 100)}%`;
            
            const downloadBtn = fileItem.querySelector('.download-btn');
            if (downloadBtn) {
                if (progress < 1) {
                    downloadBtn.textContent = `${Math.round(progress * 100)}%`;
                } else {
                    downloadBtn.textContent = 'Complete';
                    downloadBtn.style.background = 'rgba(76, 175, 80, 0.2)';
                }
            }
        }
    }
    
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    displayExistingFiles(files) {
        files.forEach(file => this.displayFileItem(file));
    }
    
    showStatus(message, type) {
        const statusDiv = document.getElementById('status-messages');
        const statusEl = document.createElement('div');
        statusEl.className = `status ${type}`;
        statusEl.textContent = message;
        statusDiv.appendChild(statusEl);
        
        setTimeout(() => {
            if (statusEl.parentNode) {
                statusEl.remove();
            }
        }, 5000);
    }
}

// Global functions
function createRoom() {
    app.createRoom();
}

function joinRoom() {
    app.joinRoom();
}

function showJoinForm() {
    app.showJoinForm();
}

function switchToJoinMode() {
    app.switchToJoinMode();
}

function showSharePopup() {
    app.showSharePopup();
}

function closeSharePopup() {
    app.closeSharePopup();
}

function copyShareLink() {
    app.copyShareLink();
}

// Initialize the application
const app = new SecureShare();
