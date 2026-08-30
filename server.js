const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

let servers = [
    { id: 101, name: "Genel Lobi 1", host: "Sistem", players: 1, max: 20, inGame: false }
];

let roomsData = {
    101: {
        players: [{ socketId: "system", name: "Sistem", isHost: true, isAdmin: false, isBot: true, totalClicks: 0, cps: 0 }],
        timerVal: 15,
        timerInterval: null
    }
};

let botNamesPool = [
    "Eren", "Mert", "Enes", "Yağız", "Burak", "Arda", 
    "ShadowX", "NightWolf", "GhostRider", "DarkLord", "Anarşik", 
    "KralSinan", "BatuPro", "DemirYurek", "Fırtına", "AsiKurt"
];

function getUniqueName(baseName, existingList) {
    let unique = baseName;
    let counter = 2;
    let namesInUse = existingList.map(p => p.name);
    while (namesInUse.includes(unique)) {
        unique = `${baseName}_${counter}`;
        counter++;
    }
    return unique;
}

function handlePlayerLeave(socket) {
    if (socket.data.currentServerId) {
        const srvId = socket.data.currentServerId;
        const srv = servers.find(s => s.id === srvId);
        
        if (roomsData[srvId]) {
            roomsData[srvId].players = roomsData[srvId].players.filter(p => p.socketId !== socket.id);
            
            if (roomsData[srvId].players.length === 0 && srvId !== 101) {
                if (roomsData[srvId].timerInterval) clearInterval(roomsData[srvId].timerInterval);
                delete roomsData[srvId];
                servers = servers.filter(s => s.id !== srvId);
            } else {
                if (roomsData[srvId].players.length > 0 && !roomsData[srvId].players.some(p => p.isHost)) {
                    roomsData[srvId].players[0].isHost = true;
                    if (srv) srv.host = roomsData[srvId].players[0].name;
                }
                if (srv) {
                    srv.players = roomsData[srvId].players.length;
                }
                io.to(srvId).emit('lobby-update', roomsData[srvId]);
            }
        }
        
        if (srv && srv.players <= 0 && srvId !== 101) {
            servers = servers.filter(s => s.id !== srvId);
        }
        
        io.emit('server-list-update', servers);
        socket.data.currentServerId = null;
    }
}

io.on('connection', (socket) => {
    console.log(`Bir oyuncu bağlandı: ${socket.id}`);
    socket.emit('server-list-update', servers);

    socket.on('get-servers', () => { socket.emit('server-list-update', servers); });

    socket.on('create-server', (data) => {
        const srvId = Date.now();
        const uniqueHostName = data.playerName;
        
        const newSrv = {
            id: srvId,
            name: data.serverName,
            host: uniqueHostName,
            players: 1,
            max: 20,
            inGame: false
        };

        servers.unshift(newSrv);
        socket.join(srvId);
        socket.data.currentServerId = srvId;
        socket.data.playerName = uniqueHostName;

        roomsData[srvId] = {
            players: [{ socketId: socket.id, name: uniqueHostName, isHost: true, isAdmin: data.isAdmin, isBot: false, totalClicks: 0, cps: 0 }],
            timerVal: 15,
            timerInterval: null
        };

        let botCount = Math.floor(Math.random() * 5) + 3;
        for(let i=0; i<botCount; i++) {
            let randBase = botNamesPool[Math.floor(Math.random() * botNamesPool.length)];
            let botName = getUniqueName(randBase, roomsData[srvId].players);
            roomsData[srvId].players.push({ socketId: `bot_${Math.random()}`, name: botName, isHost: false, isAdmin: false, isBot: true, totalClicks: 0, cps: 0 });
        }
        newSrv.players = roomsData[srvId].players.length;

        io.emit('server-list-update', servers);
        socket.emit('server-joined', { server: newSrv, isHost: true });
        io.to(srvId).emit('lobby-update', roomsData[srvId]);
    });

    socket.on('join-server', (data) => {
        const { serverId, playerName, isAdmin } = data;
        const srv = servers.find(s => s.id === serverId);

        if (srv && !srv.inGame && srv.players < srv.max) {
            socket.join(serverId);
            socket.data.currentServerId = serverId;

            if (!roomsData[serverId]) {
                roomsData[serverId] = { players: [], timerVal: 15, timerInterval: null };
            }

            let uniqueName = getUniqueName(playerName, roomsData[serverId].players);
            socket.data.playerName = uniqueName;

            roomsData[serverId].players.push({
                socketId: socket.id,
                name: uniqueName,
                isHost: false,
                isAdmin: isAdmin,
                isBot: false,
                totalClicks: 0,
                cps: 0
            });

            srv.players = roomsData[serverId].players.length;

            io.emit('server-list-update', servers);
            socket.emit('server-joined', { server: srv, isHost: false });
            io.to(serverId).emit('lobby-update', roomsData[serverId]);
        } else {
            socket.emit('alert', 'Sunucu dolu, oyunda veya bulunamadı!');
        }
    });

    socket.on('update-stats', (data) => {
        if (!data.serverId || !roomsData[data.serverId]) return;
        let playerObj = roomsData[data.serverId].players.find(p => p.socketId === socket.id);
        if (playerObj) {
            playerObj.totalClicks = data.totalClicks;
            playerObj.cps = data.cps;
        }
    });

    socket.on('start-game', (serverId) => {
        const srv = servers.find(s => s.id === serverId);
        if (srv) {
            srv.inGame = true;
            io.emit('server-list-update', servers);
            io.to(serverId).emit('start-game-signal', roomsData[serverId]);
        }
    });

    socket.on('send-chat', (data) => {
        io.to(data.serverId).emit('chat-broadcast', data);
    });

    socket.on('admin-action', (data) => {
        const { serverId, action, targetName, banReason } = data;
        if (roomsData[serverId]) {
            let targetPlayer = roomsData[serverId].players.find(p => p.name === targetName);
            if (targetPlayer && targetPlayer.socketId) {
                io.to(targetPlayer.socketId).emit('force-disconnect', { reason: banReason });
                io.to(serverId).emit('chat-broadcast', { sender: "SİSTEM", text: `${targetName} kurucu tarafından uzaklaştırıldı! Sebep: ${banReason}`, isSystem: true });
            }
        }
    });

    socket.on('leave-server', (serverId) => {
        socket.leave(serverId);
        handlePlayerLeave(socket);
    });

    socket.on('disconnect', () => {
        console.log(`Bir oyuncu ayrıldı: ${socket.id}`);
        handlePlayerLeave(socket);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});
