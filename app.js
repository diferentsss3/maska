// Инициализация Telegram WebApp
const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// Подключение к серверу (URL берется из config.js)
const socket = io(window.APP_CONFIG.SERVER_URL);

// Экраны
const screens = {
    home: document.getElementById('screen-home'),
    topics: document.getElementById('screen-topics'),
    age: document.getElementById('screen-18plus'),
    loading: document.getElementById('screen-loading'),
    chat: document.getElementById('screen-chat')
};

let selectedTopic = 'free';
let currentGender = 'any';

// --- НАВИГАЦИЯ ---
function goTo(screenId) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
}

// Выбор пола
document.querySelectorAll('.gender-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.gender-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentGender = e.target.innerText;
    });
});

document.getElementById('btn-to-topics').addEventListener('click', () => goTo('screen-topics'));

// Выбор темы
document.querySelectorAll('.topic-card').forEach(card => {
    card.addEventListener('click', (e) => {
        document.querySelectorAll('.topic-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedTopic = card.getAttribute('data-topic');
    });
});

document.getElementById('btn-start-search').addEventListener('click', () => {
    if (selectedTopic === 'adult') {
        goTo('screen-18plus');
    } else {
        startSearch();
    }
});

// 18+
const ageCheckbox = document.getElementById('age-checkbox');
const btnConfirm18 = document.getElementById('btn-confirm-18');

ageCheckbox.addEventListener('change', (e) => {
    btnConfirm18.disabled = !e.target.checked;
});

btnConfirm18.addEventListener('click', () => {
    startSearch();
});

// --- ПОИСК ---
function startSearch() {
    goTo('screen-loading');
    socket.emit('find_peer', { topic: selectedTopic, gender: currentGender });
}

document.getElementById('btn-cancel-search').addEventListener('click', () => {
    goTo('screen-home');
    socket.emit('stop_chat');
});

// --- ЧАТ ---
const chatMessages = document.getElementById('chat-messages');
const msgInput = document.getElementById('message-input');
const quickReplies = document.getElementById('quick-replies');

document.getElementById('btn-send').addEventListener('click', sendMessage);
msgInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

function sendMessage() {
    const text = msgInput.value.trim();
    if (text) {
        socket.emit('send_message', { text });
        addMessage(text, 'my');
        msgInput.value = '';
        quickReplies.style.display = 'none'; // Скрываем быстрые ответы
    }
}

function sendQuick(text) {
    msgInput.value = text;
    sendMessage();
}

document.getElementById('btn-stop').addEventListener('click', endChat);
document.getElementById('btn-back-from-chat').addEventListener('click', endChat);

function endChat() {
    socket.emit('stop_chat');
    goTo('screen-home');
    chatMessages.innerHTML = '<div class="system-message">Собеседник найден</div>';
    quickReplies.style.display = 'flex';
    msgInput.disabled = false;
}

// --- СОКЕТЫ ---
socket.on('chat_started', () => {
    goTo('screen-chat');
    chatMessages.innerHTML = '<div class="system-message">Собеседник найден</div>';
    quickReplies.style.display = 'flex';
    msgInput.disabled = false;
    msgInput.focus();
});

socket.on('receive_message', (data) => {
    addMessage(data.text, 'peer');
});

socket.on('peer_disconnected', () => {
    chatMessages.innerHTML += '<div class="system-message">Собеседник покинул чат</div>';
    msgInput.disabled = true;
    quickReplies.style.display = 'none';
    setTimeout(() => {
        goTo('screen-home');
    }, 2000);
});

function addMessage(text, sender) {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message', sender);
    msgDiv.innerText = text;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}