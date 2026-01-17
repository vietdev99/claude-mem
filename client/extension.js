const vscode = require('vscode');
const { exec } = require('child_process');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const fs = require('fs');

const HOME = os.homedir();
const BUN_PATH = path.join(HOME, '.bun', 'bin', 'bun.exe');
const WORKER_SCRIPT = path.join(HOME, '.claude', 'plugins', 'marketplaces', 'thedotmack', 'scripts', 'worker-service.cjs');
const CREDENTIALS_PATH = path.join(HOME, '.claude-mem', 'credentials.json');

let statusBarItem;
let currentUser = null;
let authTokens = null;
let loginPanel = null;

function getServerUrl() {
    const config = vscode.workspace.getConfiguration('claude-mem');
    return config.get('serverUrl') || 'http://localhost:37777';
}

function getWorkerPort() {
    const serverUrl = getServerUrl();
    try {
        const url = new URL(serverUrl);
        return parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80);
    } catch {
        return 37777;
    }
}

function getServerHost() {
    const serverUrl = getServerUrl();
    try {
        const url = new URL(serverUrl);
        return url.hostname;
    } catch {
        return '127.0.0.1';
    }
}

function isHttps() {
    return getServerUrl().startsWith('https://');
}

function activate(context) {
    console.log('Claude-Mem extension activating...');

    // Load saved credentials
    loadCredentials();

    // Status bar
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'claude-mem.showUserPanel';
    updateStatusBar();
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('claude-mem.saveContext', saveContext),
        vscode.commands.registerCommand('claude-mem.openViewer', openViewer),
        vscode.commands.registerCommand('claude-mem.startWorker', startWorker),
        vscode.commands.registerCommand('claude-mem.login', showLoginPanel),
        vscode.commands.registerCommand('claude-mem.logout', logout),
        vscode.commands.registerCommand('claude-mem.showUserPanel', showUserPanel)
    );

    // Auto start worker only for localhost
    if (getServerHost() === '127.0.0.1' || getServerHost() === 'localhost') {
        startWorker();
    }

    // Check status periodically
    checkWorkerStatus();
    setInterval(checkWorkerStatus, 15000);
}

function loadCredentials() {
    try {
        if (fs.existsSync(CREDENTIALS_PATH)) {
            const data = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
            currentUser = data.user || null;
            authTokens = data.tokens || null;
        }
    } catch (e) {
        console.error('Failed to load credentials:', e);
    }
}

function saveCredentials() {
    try {
        const dir = path.dirname(CREDENTIALS_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify({
            user: currentUser,
            tokens: authTokens
        }, null, 2));
    } catch (e) {
        console.error('Failed to save credentials:', e);
    }
}

function clearCredentials() {
    try {
        if (fs.existsSync(CREDENTIALS_PATH)) {
            fs.unlinkSync(CREDENTIALS_PATH);
        }
    } catch (e) {
        console.error('Failed to clear credentials:', e);
    }
    currentUser = null;
    authTokens = null;
}

function updateStatusBar() {
    if (currentUser) {
        statusBarItem.text = `$(database) Claude-Mem: ${currentUser.username}`;
        statusBarItem.tooltip = `Logged in as ${currentUser.username} (${currentUser.role})\nClick for options`;
        statusBarItem.backgroundColor = undefined;
    } else {
        statusBarItem.text = '$(account) Claude-Mem: Login';
        statusBarItem.tooltip = 'Click to login to Claude-Mem';
        statusBarItem.backgroundColor = undefined;
    }
}

function checkWorkerStatus() {
    const options = {
        hostname: getServerHost(),
        port: getWorkerPort(),
        path: '/api/health',
        method: 'GET',
        timeout: 3000
    };

    const httpModule = isHttps() ? https : http;
    const req = httpModule.request(options, (res) => {
        if (res.statusCode === 200) {
            if (currentUser) {
                statusBarItem.text = `$(database) Claude-Mem: ${currentUser.username}`;
            } else {
                statusBarItem.text = '$(account) Claude-Mem: Login';
            }
            statusBarItem.backgroundColor = undefined;
        }
    });

    req.on('error', () => {
        statusBarItem.text = '$(warning) Claude-Mem: Offline';
        statusBarItem.tooltip = 'Claude-Mem: Server offline';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    });

    req.end();
}

function startWorker() {
    exec(`"${BUN_PATH}" "${WORKER_SCRIPT}" start`, { timeout: 15000 }, (error, stdout) => {
        if (error && !stdout?.includes('ready')) {
            console.error('Claude-Mem worker error:', error);
        }
        setTimeout(checkWorkerStatus, 2000);
    });
}

function openViewer() {
    const serverUrl = getServerUrl();
    vscode.env.openExternal(vscode.Uri.parse(serverUrl));
}

function showUserPanel() {
    if (currentUser) {
        // Show quick pick with options
        vscode.window.showQuickPick([
            { label: '$(browser) Open Viewer', description: 'Open Claude-Mem in browser', action: 'viewer' },
            { label: '$(note) Save Context', description: 'Save current context', action: 'save' },
            { label: '$(person) Profile', description: `${currentUser.username} (${currentUser.role})`, action: 'profile' },
            { label: '$(sign-out) Logout', description: 'Sign out of Claude-Mem', action: 'logout' }
        ], { placeHolder: 'Claude-Mem Options' }).then(selected => {
            if (!selected) return;
            switch (selected.action) {
                case 'viewer': openViewer(); break;
                case 'save': saveContext(); break;
                case 'logout': logout(); break;
                case 'profile':
                    vscode.window.showInformationMessage(`Logged in as ${currentUser.username} (${currentUser.role})`);
                    break;
            }
        });
    } else {
        showLoginPanel();
    }
}

function showLoginPanel() {
    if (loginPanel) {
        loginPanel.reveal();
        return;
    }

    loginPanel = vscode.window.createWebviewPanel(
        'claudeMemLogin',
        'Claude-Mem Login',
        vscode.ViewColumn.One,
        { enableScripts: true }
    );

    loginPanel.webview.html = getLoginPanelHtml();

    loginPanel.webview.onDidReceiveMessage(async message => {
        switch (message.command) {
            case 'login':
                await handleLogin(message.username, message.password);
                break;
            case 'register':
                await handleRegister(message.username, message.password);
                break;
        }
    });

    loginPanel.onDidDispose(() => {
        loginPanel = null;
    });
}

function getLoginPanelHtml() {
    const serverUrl = getServerUrl();
    return `<!DOCTYPE html>
<html>
<head>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            padding: 20px;
            max-width: 400px;
            margin: 0 auto;
        }
        .logo {
            text-align: center;
            margin-bottom: 30px;
        }
        .logo h1 {
            font-size: 24px;
            font-weight: 300;
            color: var(--vscode-foreground);
        }
        .tabs {
            display: flex;
            margin-bottom: 20px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .tab {
            flex: 1;
            padding: 10px;
            text-align: center;
            cursor: pointer;
            border: none;
            background: transparent;
            color: var(--vscode-foreground);
            border-bottom: 2px solid transparent;
        }
        .tab.active {
            border-bottom-color: var(--vscode-button-background);
            color: var(--vscode-button-background);
        }
        .form-group {
            margin-bottom: 15px;
        }
        .form-group label {
            display: block;
            margin-bottom: 5px;
            color: var(--vscode-foreground);
        }
        .form-group input {
            width: 100%;
            padding: 8px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            box-sizing: border-box;
        }
        .form-group input:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }
        button[type="submit"] {
            width: 100%;
            padding: 10px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }
        button[type="submit"]:hover {
            background: var(--vscode-button-hoverBackground);
        }
        button[type="submit"]:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }
        .error {
            padding: 10px;
            background: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            color: var(--vscode-inputValidation-errorForeground);
            border-radius: 4px;
            margin-bottom: 15px;
        }
        .server-info {
            text-align: center;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-top: 20px;
        }
        .note {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            text-align: center;
            margin-bottom: 15px;
        }
        #loginForm, #registerForm { display: none; }
        #loginForm.active, #registerForm.active { display: block; }
    </style>
</head>
<body>
    <div class="logo">
        <h1>VClaudeMem</h1>
    </div>

    <div class="tabs">
        <button class="tab active" onclick="showTab('login')">Login</button>
        <button class="tab" onclick="showTab('register')">Register</button>
    </div>

    <div id="error" class="error" style="display: none;"></div>

    <form id="loginForm" class="active">
        <div class="form-group">
            <label>Username</label>
            <input type="text" id="loginUsername" placeholder="Enter username" required>
        </div>
        <div class="form-group">
            <label>Password</label>
            <input type="password" id="loginPassword" placeholder="Enter password" required>
        </div>
        <button type="submit" id="loginBtn">Sign In</button>
    </form>

    <form id="registerForm">
        <div class="note">First user becomes admin</div>
        <div class="form-group">
            <label>Username</label>
            <input type="text" id="registerUsername" placeholder="Choose username" required minlength="3">
        </div>
        <div class="form-group">
            <label>Password</label>
            <input type="password" id="registerPassword" placeholder="Choose password" required minlength="6">
        </div>
        <div class="form-group">
            <label>Confirm Password</label>
            <input type="password" id="registerConfirm" placeholder="Confirm password" required>
        </div>
        <button type="submit" id="registerBtn">Create Account</button>
    </form>

    <div class="server-info">
        Server: ${serverUrl}
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function showTab(tab) {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('form').forEach(f => f.classList.remove('active'));

            if (tab === 'login') {
                document.querySelector('.tabs .tab:first-child').classList.add('active');
                document.getElementById('loginForm').classList.add('active');
            } else {
                document.querySelector('.tabs .tab:last-child').classList.add('active');
                document.getElementById('registerForm').classList.add('active');
            }
            hideError();
        }

        function showError(msg) {
            const el = document.getElementById('error');
            el.textContent = msg;
            el.style.display = 'block';
        }

        function hideError() {
            document.getElementById('error').style.display = 'none';
        }

        document.getElementById('loginForm').addEventListener('submit', function(e) {
            e.preventDefault();
            hideError();
            const btn = document.getElementById('loginBtn');
            btn.disabled = true;
            btn.textContent = 'Signing in...';

            vscode.postMessage({
                command: 'login',
                username: document.getElementById('loginUsername').value,
                password: document.getElementById('loginPassword').value
            });
        });

        document.getElementById('registerForm').addEventListener('submit', function(e) {
            e.preventDefault();
            hideError();

            const password = document.getElementById('registerPassword').value;
            const confirm = document.getElementById('registerConfirm').value;

            if (password !== confirm) {
                showError('Passwords do not match');
                return;
            }

            const btn = document.getElementById('registerBtn');
            btn.disabled = true;
            btn.textContent = 'Creating account...';

            vscode.postMessage({
                command: 'register',
                username: document.getElementById('registerUsername').value,
                password: password
            });
        });

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'error') {
                showError(message.message);
                document.getElementById('loginBtn').disabled = false;
                document.getElementById('loginBtn').textContent = 'Sign In';
                document.getElementById('registerBtn').disabled = false;
                document.getElementById('registerBtn').textContent = 'Create Account';
            }
        });
    </script>
</body>
</html>`;
}

async function handleLogin(username, password) {
    try {
        const result = await httpRequest({
            hostname: getServerHost(),
            port: getWorkerPort(),
            path: '/api/auth/login',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, JSON.stringify({ username, password }));

        if (result.statusCode === 200) {
            const data = JSON.parse(result.body);
            currentUser = data.user;
            authTokens = data.tokens;
            saveCredentials();
            updateStatusBar();

            if (loginPanel) {
                loginPanel.dispose();
            }

            vscode.window.showInformationMessage(`Welcome, ${currentUser.username}!`);
        } else {
            const error = JSON.parse(result.body);
            if (loginPanel) {
                loginPanel.webview.postMessage({ type: 'error', message: error.error || 'Login failed' });
            }
        }
    } catch (e) {
        if (loginPanel) {
            loginPanel.webview.postMessage({ type: 'error', message: 'Connection failed' });
        }
    }
}

async function handleRegister(username, password) {
    try {
        const result = await httpRequest({
            hostname: getServerHost(),
            port: getWorkerPort(),
            path: '/api/auth/register',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, JSON.stringify({ username, password }));

        if (result.statusCode === 200 || result.statusCode === 201) {
            const data = JSON.parse(result.body);
            currentUser = data.user;
            authTokens = data.tokens;
            saveCredentials();
            updateStatusBar();

            if (loginPanel) {
                loginPanel.dispose();
            }

            const roleMsg = currentUser.role === 'admin' ? ' (Admin)' : '';
            vscode.window.showInformationMessage(`Account created! Welcome, ${currentUser.username}${roleMsg}`);
        } else {
            const error = JSON.parse(result.body);
            if (loginPanel) {
                loginPanel.webview.postMessage({ type: 'error', message: error.error || 'Registration failed' });
            }
        }
    } catch (e) {
        if (loginPanel) {
            loginPanel.webview.postMessage({ type: 'error', message: 'Connection failed' });
        }
    }
}

async function logout() {
    if (authTokens?.refreshToken) {
        try {
            await httpRequest({
                hostname: getServerHost(),
                port: getWorkerPort(),
                path: '/api/auth/logout',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            }, JSON.stringify({ refreshToken: authTokens.refreshToken }));
        } catch (e) {
            // Ignore logout errors
        }
    }

    clearCredentials();
    updateStatusBar();
    vscode.window.showInformationMessage('Logged out of Claude-Mem');
}

// Helper to make HTTP requests with Promise
function httpRequest(options, data) {
    return new Promise((resolve, reject) => {
        const httpModule = isHttps() ? https : http;
        const req = httpModule.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                resolve({ statusCode: res.statusCode, body });
            });
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

async function saveContext() {
    if (!currentUser) {
        const action = await vscode.window.showWarningMessage(
            'Please login to save context',
            'Login'
        );
        if (action === 'Login') {
            showLoginPanel();
        }
        return;
    }

    const description = await vscode.window.showInputBox({
        prompt: 'What did you learn or accomplish?',
        placeHolder: 'e.g., Fixed authentication bug, Implemented new feature'
    });

    if (!description) return;

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const projectName = workspaceFolder ? path.basename(workspaceFolder.uri.fsPath) : 'unknown';
    const cwd = workspaceFolder ? workspaceFolder.uri.fsPath : process.cwd();
    const contentSessionId = `vscode-manual-${Date.now()}`;

    const headers = {
        'Content-Type': 'application/json'
    };

    if (authTokens?.accessToken) {
        headers['Authorization'] = `Bearer ${authTokens.accessToken}`;
    }

    try {
        // Step 1: Initialize session
        const initData = JSON.stringify({
            contentSessionId,
            project: projectName,
            prompt: description
        });

        const initResult = await httpRequest({
            hostname: getServerHost(),
            port: getWorkerPort(),
            path: '/api/sessions/init',
            method: 'POST',
            headers: { ...headers, 'Content-Length': Buffer.byteLength(initData) }
        }, initData);

        if (initResult.statusCode !== 200 && initResult.statusCode !== 201) {
            throw new Error(`Session init failed: ${initResult.statusCode}`);
        }

        // Step 2: Save the observation
        const obsData = JSON.stringify({
            contentSessionId,
            tool_name: 'VSCode-Manual-Note',
            tool_input: { description, project: projectName },
            tool_response: description,
            cwd
        });

        const obsResult = await httpRequest({
            hostname: getServerHost(),
            port: getWorkerPort(),
            path: '/api/sessions/observations',
            method: 'POST',
            headers: { ...headers, 'Content-Length': Buffer.byteLength(obsData) }
        }, obsData);

        if (obsResult.statusCode === 200 || obsResult.statusCode === 201) {
            const response = JSON.parse(obsResult.body);
            if (response.status === 'skipped') {
                vscode.window.showWarningMessage(`Claude-Mem: Skipped - ${response.reason || 'unknown reason'}`);
            } else {
                vscode.window.showInformationMessage('Claude-Mem: Context saved!');
            }
        } else if (obsResult.statusCode === 401) {
            // Token expired, try to refresh
            vscode.window.showWarningMessage('Session expired. Please login again.');
            clearCredentials();
            updateStatusBar();
        } else {
            vscode.window.showWarningMessage(`Claude-Mem: Could not save context (${obsResult.statusCode})`);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Claude-Mem: ${error.message || 'Server not running'}`);
    }
}

function deactivate() {
    if (statusBarItem) statusBarItem.dispose();
    if (loginPanel) loginPanel.dispose();
}

module.exports = { activate, deactivate };
