const API_BASE = window.location.origin;

const treeRoot = document.getElementById('tree-root');
const logViewer = document.getElementById('log-viewer');
const logsContainer = document.getElementById('logs-container');
const emptyState = document.getElementById('empty-state');
const currentTagTitle = document.getElementById('current-tag');
const streamStatus = document.getElementById('stream-status');
const clearBtn = document.getElementById('clear-btn');
const autoscrollToggle = document.getElementById('autoscroll-toggle');

const metadataPills = document.getElementById('metadata-pills');
const viewTabs = document.getElementById('view-tabs');
const tabBtns = document.querySelectorAll('.tab-btn');
const metricsViewer = document.getElementById('metrics-viewer');

let currentEventSource = null;
let isAutoScroll = true;
let lastTreeData = '';

let errChartInst = null;
let sysChartInst = null;

// Utility to escape HTML
function escapeHtml(unsafe) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

// Fetch and render the tree
async function fetchTree() {
    try {
        const res = await fetch(`${API_BASE}/api/logs/tree`);
        if(res.status === 401) {
            window.location.href = '/login.html';
            return;
        }
        const data = await res.json();
        const dataStr = JSON.stringify(data);
        
        const openFolders = new Set();
        if (lastTreeData !== '') {
            document.querySelectorAll('.tree-header').forEach(h => {
                const titleSpan = h.querySelector('span:not(.tree-icon)');
                const nextNode = h.nextElementSibling;
                if(titleSpan && nextNode && nextNode.classList.contains('tree-children') && nextNode.classList.contains('open')) {
                     openFolders.add(titleSpan.innerText);
                }
            });
        }
        
        if (dataStr === lastTreeData) return; 
        lastTreeData = dataStr;
        
        treeRoot.innerHTML = '';
        if (data.length === 0) {
            treeRoot.innerHTML = '<div class="loading-tree">No logs found yet.</div>';
            return;
        }
        renderTree(data, treeRoot, openFolders);
    } catch (e) {
        treeRoot.innerHTML = '<div class="loading-tree" style="color:var(--log-error)">Failed to load tree</div>';
    }
}

function renderTree(nodes, container, openFolders = new Set()) {
    nodes.forEach(node => {
        const item = document.createElement('div');
        item.className = 'tree-item';
        
        const header = document.createElement('div');
        header.className = 'tree-header';
        
        const icon = document.createElement('span');
        icon.className = 'tree-icon';
        icon.innerText = node.type === 'directory' ? '📁' : '📄';
        
        const title = document.createElement('span');
        title.innerText = node.name;
        
        header.appendChild(icon);
        header.appendChild(title);
        item.appendChild(header);
        
        if (node.type === 'directory') {
            const childrenContainer = document.createElement('div');
            childrenContainer.className = 'tree-children';
            renderTree(node.children, childrenContainer, openFolders);
            item.appendChild(childrenContainer);
            
            if (openFolders.has(node.name)) {
                childrenContainer.classList.add('open');
                icon.innerText = '📂';
            }
            
            header.addEventListener('click', () => {
                const isOpen = childrenContainer.classList.contains('open');
                if (isOpen) {
                    childrenContainer.classList.remove('open');
                    icon.innerText = '📁';
                } else {
                    childrenContainer.classList.add('open');
                    icon.innerText = '📂';
                }
            });
        } else {
            if (node.tag === currentTagTitle.innerText) {
                header.classList.add('active');
            }
            header.addEventListener('click', () => {
                document.querySelectorAll('.tree-header').forEach(h => h.classList.remove('active'));
                header.classList.add('active');
                selectLogSource(node.tag);
            });
        }
        
        container.appendChild(item);
    });
}

// Select a log source
async function selectLogSource(tag) {
    currentTagTitle.innerText = tag;
    emptyState.style.display = 'none';
    viewTabs.style.display = 'flex';
    logsContainer.innerHTML = '';
    metadataPills.innerHTML = '';
    streamStatus.classList.remove('active');
    
    // Switch to logs tab by default
    switchTab('logs');

    if (currentEventSource) {
        currentEventSource.close();
    }
    
    // Fetch History
    try {
        const res = await fetch(`${API_BASE}/api/logs/history?tag=${encodeURIComponent(tag)}`);
        const text = await res.text();
        const lines = text.split('\n');
        lines.forEach(line => {
            if(line.trim()) appendLog(line);
        });
    } catch(e) {
        appendLog(`[ERROR] Failed to load history: ${e.message}`);
    }

    // Start SSE Stream
    currentEventSource = new EventSource(`${API_BASE}/api/logs/stream?tag=${encodeURIComponent(tag)}`);
    
    currentEventSource.onopen = () => {
        streamStatus.classList.add('active');
    };
    
    currentEventSource.addEventListener('log', (event) => {
        try {
            const data = JSON.parse(event.data);
            if(data.trim()) appendLog(data);
            
            // Update chart dynamically
            if (errChartInst) {
                const isError = data.includes('[ERROR]') || data.includes('[ALERT]') || data.includes('[SLIENTERROR]');
                const isWarn = data.includes('[WARN]') || data.includes('[WARNING]') || data.includes('[SLIENTWARN]');
                const isSuccess = data.includes('[SUCCESS]');
                const isInfo = !(isError || isWarn || isSuccess);
                
                const now = new Date();
                const timeLabel = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
                
                errChartInst.data.labels.push(timeLabel);
                errChartInst.data.datasets[0].data.push(isError ? 1 : 0);
                errChartInst.data.datasets[1].data.push(isWarn ? 1 : 0);
                errChartInst.data.datasets[2].data.push(isInfo ? 1 : 0);
                errChartInst.data.datasets[3].data.push(isSuccess ? 1 : 0);
                errChartInst.update();
            }
        } catch(e) {
            if(event.data.trim()) appendLog(event.data);
        }
    });

    currentEventSource.addEventListener('meta', (event) => {
        try {
            const data = JSON.parse(event.data);
            updateMetadataPills(data);
            
            // Update chart dynamically
            if (sysChartInst) {
                const now = new Date();
                const timeLabel = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
                sysChartInst.data.labels.push(timeLabel);
                
                sysChartInst.data.datasets.forEach(ds => {
                    const key = ds.label.toLowerCase();
                    ds.data.push(data[key] !== undefined ? data[key] : null);
                });
                sysChartInst.update();
            }
        } catch(e) {}
    });
    
    currentEventSource.onerror = () => {
        streamStatus.classList.remove('active');
    };

    // Preload metrics history
    fetchMetricsHistory(tag);
}

function updateMetadataPills(data) {
    metadataPills.innerHTML = '';
    Object.keys(data).forEach(key => {
        if (key === 'timestamp') return;
        const pill = document.createElement('div');
        pill.className = 'meta-pill';
        
        let displayVal = data[key];
        if (typeof displayVal === 'number' && !Number.isInteger(displayVal)) {
            displayVal = displayVal.toFixed(2);
        }

        pill.innerHTML = `<strong>${escapeHtml(key.toUpperCase())}</strong> ${escapeHtml(String(displayVal))}`;
        metadataPills.appendChild(pill);
    });
}

function appendLog(line) {
    const div = document.createElement('div');
    div.className = 'log-line';
    
    if (line.includes('[INFO]') || line.includes('[LOG]')) div.classList.add('level-info');
    else if (line.includes('[WARN]') || line.includes('[WARNING]')) div.classList.add('level-warn');
    else if (line.includes('[ERROR]') || line.includes('[ALERT]')) div.classList.add('level-error');
    else if (line.includes('[SUCCESS]')) div.classList.add('level-success');
    
    const match = line.match(/^(\[[A-Z]+\])\s([\d\.\s:]+)\s-\s(.*)/);
    if (match) {
        div.innerHTML = `<span class="log-timestamp">${match[2]}</span><span style="font-weight:600;margin-right:8px">${match[1]}</span><span>${escapeHtml(match[3])}</span>`;
    } else {
        div.innerHTML = `<span>${escapeHtml(line)}</span>`;
    }
    
    logsContainer.appendChild(div);
    
    if (isAutoScroll && logViewer.style.display !== 'none') {
        logViewer.scrollTop = logViewer.scrollHeight;
    }
}

// Tab Switching
function switchTab(tabId) {
    tabBtns.forEach(b => b.classList.remove('active'));
    document.querySelector(`.tab-btn[data-tab="${tabId}"]`).classList.add('active');

    if (tabId === 'logs') {
        logViewer.style.display = 'block';
        metricsViewer.style.display = 'none';
        if (isAutoScroll) logViewer.scrollTop = logViewer.scrollHeight;
    } else {
        logViewer.style.display = 'none';
        metricsViewer.style.display = 'block';
    }
}

tabBtns.forEach(btn => {
    btn.addEventListener('click', (e) => switchTab(e.target.dataset.tab));
});

// Metrics Logic
async function fetchMetricsHistory(tag) {
    try {
        const res = await fetch(`${API_BASE}/api/logs/metrics?tag=${encodeURIComponent(tag)}`);
        const text = await res.text();
        const lines = text.split('\n').filter(l => l.trim() !== '');
        
        const labels = [];
        const errorData = [];
        const warnData = [];
        const infoData = [];
        const successData = [];
        
        const customMetrics = {};
        let hasCustomMetrics = false;

        lines.forEach(line => {
            try {
                const item = JSON.parse(line);
                const date = new Date(item.timestamp);
                const timeLabel = `${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}:${date.getSeconds().toString().padStart(2,'0')}`;
                
                labels.push(timeLabel);

                if (item.error_count !== undefined || item.warn_count !== undefined || item.info_count !== undefined || item.success_count !== undefined) {
                    errorData.push(item.error_count || 0);
                    warnData.push(item.warn_count || 0);
                    infoData.push(item.info_count || 0);
                    successData.push(item.success_count || 0);
                    
                    // push nulls to custom metrics to keep arrays parallel
                    Object.keys(customMetrics).forEach(k => customMetrics[k].push(null));
                } else {
                    // It's a custom meta payload
                    errorData.push(0);
                    warnData.push(0);
                    infoData.push(0);
                    successData.push(0);

                    hasCustomMetrics = true;
                    Object.keys(item).forEach(k => {
                        if (k === 'timestamp') return;
                        if (!customMetrics[k]) {
                            // backfill nulls
                            customMetrics[k] = new Array(labels.length - 1).fill(null);
                        }
                        customMetrics[k].push(item[k]);
                    });
                    
                    // backfill nulls for missing keys
                    Object.keys(customMetrics).forEach(k => {
                        if (item[k] === undefined) customMetrics[k].push(null);
                    });
                }
            } catch(e) {}
        });

        renderCharts(labels, errorData, warnData, infoData, successData, customMetrics, hasCustomMetrics);
    } catch(e) {
        console.error("Failed to load metrics", e);
    }
}

function renderCharts(labels, errorData, warnData, infoData, successData, customMetrics, hasCustomMetrics) {
    if (errChartInst) errChartInst.destroy();
    if (sysChartInst) sysChartInst.destroy();

    const errCtx = document.getElementById('chart-errors').getContext('2d');
    errChartInst = new Chart(errCtx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                { label: 'Errors', data: errorData, backgroundColor: '#ef4444' },
                { label: 'Warnings', data: warnData, backgroundColor: '#eab308' },
                { label: 'Info', data: infoData, backgroundColor: '#3b82f6' },
                { label: 'Success', data: successData, backgroundColor: '#22c55e' }
            ]
        },
        options: {
            responsive: true,
            scales: {
                x: { ticks: { color: '#9ca3af' }, grid: { color: '#2d3139' }, stacked: true },
                y: { ticks: { color: '#9ca3af' }, grid: { color: '#2d3139' }, stacked: true }
            },
            plugins: { legend: { labels: { color: '#d1d5db' } } }
        }
    });

    const metaCard = document.getElementById('custom-meta-card');
    if (hasCustomMetrics) {
        metaCard.style.display = 'block';
        
        const datasets = [];
        const colors = ['#6366f1', '#22c55e', '#3b82f6', '#ec4899', '#f97316'];
        let colorIdx = 0;

        Object.keys(customMetrics).forEach(k => {
            datasets.push({
                label: k.toUpperCase(),
                data: customMetrics[k],
                borderColor: colors[colorIdx % colors.length],
                tension: 0.3,
                spanGaps: true
            });
            colorIdx++;
        });

        const sysCtx = document.getElementById('chart-system').getContext('2d');
        sysChartInst = new Chart(sysCtx, {
            type: 'line',
            data: { labels: labels, datasets: datasets },
            options: {
                responsive: true,
                scales: {
                    x: { ticks: { color: '#9ca3af' }, grid: { color: '#2d3139' } },
                    y: { ticks: { color: '#9ca3af' }, grid: { color: '#2d3139' } }
                },
                plugins: { legend: { labels: { color: '#d1d5db' } } }
            }
        });
    } else {
        metaCard.style.display = 'none';
    }
}


// Event Listeners
clearBtn.addEventListener('click', () => {
    logsContainer.innerHTML = '';
});

autoscrollToggle.addEventListener('change', (e) => {
    isAutoScroll = e.target.checked;
});

logViewer.addEventListener('scroll', () => {
    const isAtBottom = logViewer.scrollHeight - logViewer.scrollTop <= logViewer.clientHeight + 50;
    if (!isAtBottom && isAutoScroll) {
        isAutoScroll = false;
        autoscrollToggle.checked = false;
    } else if (isAtBottom && !isAutoScroll) {
        isAutoScroll = true;
        autoscrollToggle.checked = true;
    }
});

Chart.defaults.color = '#d1d5db';
Chart.defaults.font.family = "'Inter', sans-serif";

fetchTree();
setInterval(fetchTree, 10000);
