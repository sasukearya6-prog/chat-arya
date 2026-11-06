const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Konfigurasi Socket.io
const io = new Server(server, { 
    cors: { origin: "*" }, 
    transports: ['websocket', 'polling'] 
});

// Render.com otomatis ngasih PORT lewat process.env.PORT
const PORT = process.env.PORT || 10000; 
const OWNER = 'arya';
const DIR = path.join(__dirname, 'data');

// Bikin folder data otomatis kalau belum ada
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR);

// Middleware buat baca JSON (buat fitur kirim foto/video base64)
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Route utama buka index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Helper buat baca/tulis file JSON
function read(file, def) { 
    try { return JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8')); } 
    catch(e) { return def; } 
}
function write(file, data) { 
    fs.writeFileSync(path.join(DIR, file), JSON.stringify(data, null, 2)); 
}

const online = {};

io.on('connection', (socket) => {
    // 1. LOGIN
    socket.on('login', (u) => {
        const user = u.toLowerCase().trim();
        online[user] = socket.id;
        socket.user = user;
        
        let users = read('users.json', []);
        if (!users.includes(user)) { 
            users.push(user); 
            write('users.json', users); 
        }
        
        const isOwner = user === OWNER;
        let groups = read('groups.json', []).filter(g => g.members.includes(user) || isOwner);
        
        socket.emit('login_success', { username: user, isOwner, myGroups: groups });
        
        // Sinkronisasi user real-time buat Owner
        if (isOwner) {
            socket.emit('all_users', users);
        } else {
            Object.keys(online).forEach(o => { 
                if (o === OWNER) io.to(online[o]).emit('all_users', users); 
            });
        }
    });

    // 2. BUAT GRUP / KOMUNITAS
    socket.on('create_group', (d) => {
        let groups = read('groups.json', []);
        const id = 'grp_' + Date.now();
        const members = [...new Set([...d.members, socket.user])];
        const newGroup = { id, name: d.name, type: d.type, admin: socket.user, members };
        
        groups.push(newGroup); 
        write('groups.json', groups);
        write(`group_${id}.json`, []); // Bikin history chat grup baru
        
        members.forEach(m => { 
            if (online[m]) io.to(online[m]).emit('new_group_added', newGroup); 
        });
        socket.emit('group_created', newGroup);
    });

    // 3. AMBIL HISTORY CHAT
    socket.on('get_history', (target) => {
        let msgs = target.startsWith('grp_') 
            ? read(`group_${target}.json`, []) 
            : read(`chats_${socket.user}.json`, {})[target] || [];
        socket.emit('history_loaded', { target, messages: msgs });
    });

    // 4. KIRIM PESAN / MEDIA
    socket.on('send_message', (d) => {
        const t = d.target.toLowerCase();
        const msg = { 
            from: socket.user, 
            text: d.message || '', 
            fileUrl: d.fileUrl || null, 
            fileType: d.fileType || null, 
            time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) 
        };
        
        if (t.startsWith('grp_')) {
            let gMsgs = read(`group_${t}.json`, []); 
            gMsgs.push(msg); 
            write(`group_${t}.json`, gMsgs);
            
            let groups = read('groups.json', []); 
            let g = groups.find(x => x.id === t);
            if (g) {
                g.members.forEach(m => { 
                    if (online[m]) io.to(online[m]).emit('message_received', { target: t, msg }); 
                });
            }
        } else {
            let sChats = read(`chats_${socket.user}.json`, {}); 
            if (!sChats[t]) sChats[t] = []; 
            sChats[t].push(msg); 
            write(`chats_${socket.user}.json`, sChats);
            
            let tChats = read(`chats_${t}.json`, {}); 
            if (!tChats[socket.user]) tChats[socket.user] = []; 
            tChats[socket.user].push(msg); 
            write(`chats_${t}.json`, tChats);
            
            socket.emit('message_received', { target: t, msg });
            if (online[t]) io.to(online[t]).emit('message_received', { target: socket.user, msg });
        }
    });

    // 5. ANIMASI TYPING
    socket.on('typing', (d) => {
        const t = d.target;
        if (t.startsWith('grp_')) {
            let g = read('groups.json', []).find(x => x.id === t);
            if (g) {
                g.members.forEach(m => { 
                    if (m !== socket.user && online[m]) {
                        io.to(online[m]).emit('user_typing', { target: t, username: socket.user }); 
                    }
                });
            }
        } else { 
            if (online[t]) {
                io.to(online[t]).emit('user_typing', { target: socket.user, username: socket.user }); 
            }
        }
    });

    // 6. DISCONNECT
    socket.on('disconnect', () => { 
        if (socket.user) delete online[socket.user]; 
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server Chat siap di Port: ${PORT}`);
});