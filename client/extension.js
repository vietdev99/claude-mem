const vscode = require('vscode');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const fs = require('fs');

const HOME = os.homedir();
const CREDENTIALS_PATH = path.join(HOME, '.claude-mem', 'credentials.json');

let statusBarItem;
let currentUser = null;
let authTokens = null;
let currentProject = null;
let userProjects = [];
let loginPanel = null;
let projectPanel = null;

function getServerUrl() {
    const config = vscode.workspace.getConfiguration('claude-mem');
    return config.get('serverUrl') || 'https://mcpclaude.vollx.com';
}

function getWorkerPort() {
    const serverUrl = getServerUrl();
    try {
        const url = new URL(serverUrl);
        return parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80);
    } catch {
        return 443;
    }
}

function getServerHost() {
    const serverUrl = getServerUrl();
    try {
        const url = new URL(serverUrl);
        return url.hostname;
    } catch {
        return 'mcpclaude.vollx.com';
    }
}

function isHttps() {
    return getServerUrl().startsWith('https://');
}

function activate(context) {
    console.log('VClaudeMem extension activating...');

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
        vscode.commands.registerCommand('claude-mem.login', showLoginPanel),
        vscode.commands.registerCommand('claude-mem.logout', logout),
        vscode.commands.registerCommand('claude-mem.showUserPanel', showUserPanel),
        vscode.commands.registerCommand('claude-mem.selectProject', selectProject),
        vscode.commands.registerCommand('claude-mem.createProject', createProject)
    );

    // If logged in, fetch projects
    if (currentUser && authTokens) {
        fetchProjects();
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
            currentProject = data.currentProject || null;
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
            tokens: authTokens,
            currentProject: currentProject
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
    currentProject = null;
    userProjects = [];
}

function updateStatusBar() {
    if (currentUser) {
        const projectName = currentProject ? currentProject.name : 'No Project';
        statusBarItem.text = `$(database) ${projectName}`;
        statusBarItem.tooltip = `VClaudeMem: ${currentUser.username}\nProject: ${projectName}\nClick for options`;
        statusBarItem.backgroundColor = currentProject ? undefined : new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
        statusBarItem.text = '$(account) VClaudeMem';
        statusBarItem.tooltip = 'Click to login to VClaudeMem';
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
            // Server is online
            if (!currentUser) {
                statusBarItem.text = '$(account) VClaudeMem';
            }
        }
    });

    req.on('error', () => {
        statusBarItem.text = '$(warning) VClaudeMem: Offline';
        statusBarItem.tooltip = 'VClaudeMem: Server offline';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    });

    req.end();
}

function openViewer() {
    const serverUrl = getServerUrl();
    vscode.env.openExternal(vscode.Uri.parse(serverUrl));
}

async function fetchProjects() {
    if (!authTokens?.accessToken) return;

    try {
        const result = await httpRequest({
            hostname: getServerHost(),
            port: getWorkerPort(),
            path: '/api/projects',
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${authTokens.accessToken}`
            }
        });

        if (result.statusCode === 200) {
            const data = JSON.parse(result.body);
            userProjects = data.projects || [];

            // If no current project and we have projects, select the first one
            if (!currentProject && userProjects.length > 0) {
                currentProject = userProjects[0];
                saveCredentials();
                updateStatusBar();
            }
        }
    } catch (e) {
        console.error('Failed to fetch projects:', e);
    }
}

function showUserPanel() {
    if (currentUser) {
        const items = [
            { label: '$(folder) Switch Project', description: currentProject?.name || 'None', action: 'switch' },
            { label: '$(add) Create Project', description: 'Create a new project', action: 'create' },
            { label: '$(browser) Open Viewer', description: 'Open VClaudeMem in browser', action: 'viewer' },
            { label: '$(note) Save Context', description: 'Save current context to project', action: 'save' },
            { label: '$(person) Profile', description: `${currentUser.username} (${currentUser.role})`, action: 'profile' },
            { label: '$(sign-out) Logout', description: 'Sign out of VClaudeMem', action: 'logout' }
        ];

        vscode.window.showQuickPick(items, { placeHolder: 'VClaudeMem Options' }).then(selected => {
            if (!selected) return;
            switch (selected.action) {
                case 'switch': selectProject(); break;
                case 'create': createProject(); break;
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

async function selectProject() {
    if (!currentUser) {
        showLoginPanel();
        return;
    }

    // Refresh projects list
    await fetchProjects();

    if (userProjects.length === 0) {
        const action = await vscode.window.showInformationMessage(
            'You don\'t have any projects yet.',
            'Create Project'
        );
        if (action === 'Create Project') {
            createProject();
        }
        return;
    }

    const items = userProjects.map(p => ({
        label: p.name,
        description: `${p.role} • ${p.member_count || 1} members`,
        detail: p.description || '',
        project: p
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a project'
    });

    if (selected) {
        currentProject = selected.project;
        saveCredentials();
        updateStatusBar();
        vscode.window.showInformationMessage(`Switched to project: ${currentProject.name}`);
    }
}

async function createProject() {
    if (!currentUser) {
        showLoginPanel();
        return;
    }

    const name = await vscode.window.showInputBox({
        prompt: 'Project name',
        placeHolder: 'My Project',
        validateInput: (value) => {
            if (!value || value.trim().length < 2) {
                return 'Project name must be at least 2 characters';
            }
            return null;
        }
    });

    if (!name) return;

    const description = await vscode.window.showInputBox({
        prompt: 'Project description (optional)',
        placeHolder: 'A brief description of this project'
    });

    try {
        const result = await httpRequest({
            hostname: getServerHost(),
            port: getWorkerPort(),
            path: '/api/projects',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authTokens.accessToken}`
            }
        }, JSON.stringify({ name: name.trim(), description: description?.trim() || '' }));

        if (result.statusCode === 201) {
            const project = JSON.parse(result.body);
            currentProject = project;
            userProjects.push(project);
            saveCredentials();
            updateStatusBar();
            vscode.window.showInformationMessage(`Project "${project.name}" created!`);
        } else {
            const error = JSON.parse(result.body);
            vscode.window.showErrorMessage(error.error || 'Failed to create project');
        }
    } catch (e) {
        vscode.window.showErrorMessage('Failed to create project: ' + e.message);
    }
}

function showLoginPanel() {
    if (loginPanel) {
        loginPanel.reveal();
        return;
    }

    loginPanel = vscode.window.createWebviewPanel(
        'claudeMemLogin',
        'VClaudeMem Login',
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

            // Fetch projects after login
            await fetchProjects();

            if (loginPanel) {
                loginPanel.dispose();
            }

            vscode.window.showInformationMessage(`Welcome, ${currentUser.username}!`);

            // If no project, prompt to create one
            if (userProjects.length === 0) {
                const action = await vscode.window.showInformationMessage(
                    'Create your first project to start saving context.',
                    'Create Project'
                );
                if (action === 'Create Project') {
                    createProject();
                }
            }
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

            // Prompt to create first project
            const action = await vscode.window.showInformationMessage(
                'Create your first project to start saving context.',
                'Create Project'
            );
            if (action === 'Create Project') {
                createProject();
            }
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
    vscode.window.showInformationMessage('Logged out of VClaudeMem');
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

    if (!currentProject) {
        const action = await vscode.window.showWarningMessage(
            'Please select or create a project first',
            'Select Project', 'Create Project'
        );
        if (action === 'Select Project') {
            selectProject();
        } else if (action === 'Create Project') {
            createProject();
        }
        return;
    }

    // Choose context type
    const contextType = await vscode.window.showQuickPick([
        { label: '$(note) Note', description: 'Save a general note/learning', value: 'note' },
        { label: '$(bug) Bug Fix', description: 'Document a bug fix', value: 'bugfix' },
        { label: '$(star) Feature', description: 'Document a new feature', value: 'feature' },
        { label: '$(tools) Refactor', description: 'Document a refactoring', value: 'refactor' },
        { label: '$(lightbulb) Discovery', description: 'Document a discovery', value: 'discovery' }
    ], { placeHolder: 'What type of context?' });

    if (!contextType) return;

    const description = await vscode.window.showInputBox({
        prompt: 'Describe what you learned or accomplished',
        placeHolder: 'e.g., Fixed authentication bug by updating token validation'
    });

    if (!description) return;

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const cwd = workspaceFolder ? workspaceFolder.uri.fsPath : process.cwd();
    const sessionId = `vscode-${Date.now()}`;

    try {
        const obsData = JSON.stringify({
            session_id: sessionId,
            prompt_number: 1,
            tool_name: 'VSCode-Manual',
            tool_input: JSON.stringify({ type: contextType.value, description }),
            tool_response: description,
            observation_type: contextType.value,
            narrative: description,
            cwd
        });

        const result = await httpRequest({
            hostname: getServerHost(),
            port: getWorkerPort(),
            path: `/api/projects/${currentProject.id}/observations`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authTokens.accessToken}`
            }
        }, obsData);

        if (result.statusCode === 201) {
            vscode.window.showInformationMessage(`Context saved to "${currentProject.name}"!`);
        } else if (result.statusCode === 401) {
            vscode.window.showWarningMessage('Session expired. Please login again.');
            clearCredentials();
            updateStatusBar();
        } else {
            const error = JSON.parse(result.body);
            vscode.window.showErrorMessage(error.error || 'Failed to save context');
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to save context: ${error.message}`);
    }
}

function deactivate() {
    if (statusBarItem) statusBarItem.dispose();
    if (loginPanel) loginPanel.dispose();
    if (projectPanel) projectPanel.dispose();
}

module.exports = { activate, deactivate };
