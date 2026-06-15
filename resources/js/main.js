let files = [];
let editorInstance = null;
let currentLayout = 2;
let activeCM = null; 
let isEditMode = false;
let allEditors = []; 
let columnChunks = []; // Stored chunks for custom multi-pane mode. Index 0 is always null.
let multiColumnHighlights = [];
let multiColumnSpacers = [];
let scrollMarkerSeen = null;
let scrollMarkerRanges = null;
let currentLineMarker = null;

const scrollMarkerClasses = [
    'ndiff-scroll-inserted',
    'ndiff-scroll-deleted',
    'ndiff-scroll-changed'
];

window.addEventListener('DOMContentLoaded', () => {
    init().catch(err => {
        console.error('Initialization failed:', err);
        const info = document.getElementById('file-info');
        if (info) info.innerHTML = `<span style="color: red;">Init Error: ${err.message}</span>`;
    });
});

async function init() {
    if (typeof Neutralino === 'undefined') throw new Error('Neutralino library not loaded');
    if (typeof CodeMirror === 'undefined') throw new Error('CodeMirror library not loaded');
    if (typeof diff_match_patch === 'undefined') throw new Error('diff_match_patch library not loaded');

    Neutralino.init();
    Neutralino.events.on("windowClose", handleWindowClose);

    let args = [];
    const dashDashIndex = NL_ARGS.indexOf('--');
    if (dashDashIndex !== -1) {
        args = NL_ARGS.slice(dashDashIndex + 1);
    } else {
        args = NL_ARGS.slice(1).filter(arg => !arg.startsWith('-'));
    }
    
    files = [];
    if (args.length > 0) {
        for (let path of args) {
            try {
                let content = await Neutralino.filesystem.readFile(path);
                files.push({ path, content, originalContent: content, modified: false });
            } catch (err) {
                console.error(`Error reading ${path}:`, err);
            }
        }
    }

    if (files.length >= 4) currentLayout = files.length;
    else if (files.length === 3) currentLayout = 3;
    else currentLayout = 2;

    setLayout(currentLayout);
    updateFileInfo();
    setMode(false); 
}

function setMode(edit) {
    isEditMode = edit;
    document.body.classList.toggle('line-select-mode', !edit);
    
    // Ensure we have an active editor to focus
    if (allEditors.length > 0 && !activeCM) {
        activeCM = allEditors[0];
        activeCM.getWrapperElement().classList.add('editor-active');
    }

    allEditors.forEach(cm => {
        cm.setOption('readOnly', !edit);
        cm.setOption('cursorBlinkRate', edit ? 530 : -1);
        
        if (!edit) {
            // Exiting Edit Mode: Expand existing selection to full lines
            const from = cm.getCursor('from');
            const to = cm.getCursor('to');
            if (cm === activeCM) {
                const line = cm.getCursor().line;
                cm.setSelection(
                    {line: Math.min(line + 1, cm.lineCount()), ch: 0},
                    {line, ch: 0},
                    {scroll: false}
                );
            } else if (from.line !== to.line || from.ch !== to.ch) {
                cm.setSelection(
                    {line: Math.max(from.line, to.line), ch: cm.getLine(Math.max(from.line, to.line)).length},
                    {line: Math.min(from.line, to.line), ch: 0},
                    {scroll: false}
                );
            } else {
                cm.setCursor({line: from.line, ch: 0});
            }
        } else if (cm === activeCM) {
            // Entering Edit Mode: Clear selection and put cursor on the current line.
            const line = currentLine(cm);
            cm.setSelection({line, ch: 0}, {line, ch: 0}, {scroll: true});
        }
        // Force re-render to show/hide cursor immediately
        cm.refresh();
    });

    updateCurrentLineMarker();

    if (edit && activeCM) {
        activeCM.focus();
    }
    
    updateFileInfo();
}

function handleKey(cm, e) {
    if (e.keyCode === 13 && !isEditMode) { // Enter
        e.preventDefault();
        setMode(true);
    } else if (e.keyCode === 27 && isEditMode) { // Escape
        e.preventDefault();
        setMode(false);
    } else if (!isEditMode && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && (e.keyCode === 38 || e.keyCode === 40)) {
        orientLineModeSelectionForShift(cm, e.keyCode);
    } else if (!isEditMode && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && e.keyCode >= 37 && e.keyCode <= 40) {
        e.preventDefault();
        moveLineModeSelection(e.keyCode);
    } else if ((e.keyCode === 8 || e.keyCode === 46) && !isEditMode) { // Backspace or Delete
        e.preventDefault();
        cm.replaceSelection("");
    } else if (e.keyCode === 90 && (e.metaKey || e.ctrlKey) && !isEditMode) { // Cmd/Ctrl + Z
        e.preventDefault();
        cm.undo();
    }
}
function clearOtherSelections(currentCM) {
    allEditors.forEach(cm => {
        if (cm !== currentCM) {
            // Clear selection by setting head to anchor with a custom origin
            const cur = cm.getCursor();
            cm.setSelection(cur, cur, {origin: 'clearSelection', scroll: false});
            cm.getWrapperElement().classList.remove('editor-active');
        }
    });
    currentCM.getWrapperElement().classList.add('editor-active');
    activeCM = currentCM;
    updateCurrentLineMarker();
}

function setupEditor(cm, index) {
    allEditors.push(cm);

    cm.on('focus', () => clearOtherSelections(cm));
    cm.on('mousedown', () => clearOtherSelections(cm));
    cm.on('keydown', handleKey);

    cm.on('beforeSelectionChange', (cm, obj) => {
        if (obj.origin && obj.origin !== 'setValue' && obj.origin !== 'clearSelection') {
            const hasSelection = obj.ranges.some(r => r.anchor.line !== r.head.line || r.anchor.ch !== r.head.ch);
            if (hasSelection) clearOtherSelections(cm);
        }

        if (!isEditMode && obj.ranges && obj.origin !== 'setValue' && obj.origin !== 'clearSelection') {
           // change to select by whole lines
           obj.ranges.forEach(range => {
                // drag up or down
                if (range.head.line <= range.anchor.line) {
                    range.anchor = {line: range.anchor.ch !=0 ? range.anchor.line + 1 : range.anchor.line, ch: 0}; //ch: cm.getLine(range.anchor.line).length};
                    if (range.head.outside && range.head.line) {
                      range.head = {line: range.head.line - 1, ch: cm.getLine(range.head.line - 1).length};
                    } else {
                      range.head = {line: range.head.line, ch: 0};
                    }
                } else {
                    range.anchor = {line: range.anchor.line, ch: 0};
                    range.head = {line: range.head.ch !=0 ? range.head.line + 1 : range.head.line, ch: 0};
                }
            });
        }
    });

    cm.on('cursorActivity', () => {
        if (!isEditMode && activeCM === cm) {
            // Keep the line-mode cursor in view.
            cm.scrollIntoView({line: currentLine(cm), ch: 0});
            updateCurrentLineMarker();
        }
    });

    cm.on('change', () => {
        if (files[index]) {
            files[index].content = cm.getValue();
            files[index].modified = files[index].content !== files[index].originalContent;
        }
        if (currentLayout >= 4) {
            refreshMultiColumnChunks();
        } else {
            setTimeout(updateScrollDiffMarkers, 0);
        }
    });
}

function setLayout(cols) {
    currentLayout = cols;
    allEditors = [];
    columnChunks = [];
    multiColumnHighlights = [];
    multiColumnSpacers = [];
    const container = document.getElementById('editor-container');
    container.innerHTML = ''; 

    if (cols === 2 || cols === 3) initMergeView(cols);
    else if (cols >= 4) initMultiColumnView();
}

function getTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'monokai' : 'default';
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const theme = getTheme();
    allEditors.forEach(cm => cm.setOption('theme', theme));
});

function initMergeView(cols) {
    const container = document.getElementById('editor-container');
    const mode = getMode(files[0]?.path);
    const theme = getTheme();
    const options = {
        lineNumbers: true, mode: mode,
        highlightDifferences: true, connect: 'align',
        collapseIdentical: false, theme: theme,
        revertButtons: true
    };

    if (cols === 2) {
        options.value = files[0]?.content || '';
        options.orig = files[1]?.content || '';
    } else {
        options.origLeft = files[0]?.content || '';
        options.value = files[1]?.content || '';
        options.orig = files[2]?.content || '';
    }

    editorInstance = CodeMirror.MergeView(container, options);
    
    if (cols === 2) {
        setupEditor(editorInstance.edit, 0);
        setupEditor(editorInstance.right.orig, 1);
    } else {
        setupEditor(editorInstance.left.orig, 0);
        setupEditor(editorInstance.edit, 1);
        setupEditor(editorInstance.right.orig, 2);
    }
    setTimeout(updateScrollDiffMarkers, 0);
}

function getLineChunks(text1, text2) {
    const dmp = new diff_match_patch();
    const a = dmp.diff_linesToChars_(text1, text2);
    const lineDiffs = dmp.diff_main(a.chars1, a.chars2, false);
    dmp.diff_charsToLines_(lineDiffs, a.lineArray);
    
    let chunks = [];
    let line1 = 0, line2 = 0;
    
    lineDiffs.forEach(diff => {
        const op = diff[0];
        const text = diff[1];
        const count = text.split('\n').length - 1;
        if (op === 0) { // EQUAL
            line1 += count;
            line2 += count;
        } else if (op === -1) { // DELETE (in text1)
            let chunk = {origFrom: line1, origTo: line1 + count, editFrom: line2, editTo: line2};
            chunks.push(chunk);
            line1 += count;
        } else if (op === 1) { // INSERT (in text2)
            // Check if last chunk was a delete to merge into a change
            if (chunks.length > 0 && chunks[chunks.length - 1].editFrom === line2 && chunks[chunks.length - 1].editTo === line2) {
                chunks[chunks.length - 1].editTo = line2 + count;
            } else {
                chunks.push({origFrom: line1, origTo: line1, editFrom: line2, editTo: line2 + count});
            }
            line2 += count;
        }
    });
    return chunks;
}

function clearMultiColumnHighlights() {
    multiColumnHighlights.forEach(({cm, line, className}) => {
        cm.removeLineClass(line, 'background', className);
    });
    multiColumnHighlights = [];
}

function clearMultiColumnSpacers() {
    multiColumnSpacers.forEach(widget => widget.clear());
    multiColumnSpacers = [];
}

function addMultiColumnLineClass(cm, line, className, seen) {
    if (!cm || line < cm.firstLine() || line > cm.lastLine()) return;

    const key = `${allEditors.indexOf(cm)}:${line}:${className}`;
    if (seen.has(key)) return;

    cm.addLineClass(line, 'background', className);
    multiColumnHighlights.push({cm, line, className});
    seen.add(key);
}

function addMultiColumnRangeClass(cm, from, to, className, seen) {
    for (let line = from; line < to; line++) {
        addMultiColumnLineClass(cm, line, className, seen);
    }
}

function getScrollMarkerLayer(cm) {
    if (!cm.ndiffScrollMarkerLayer) {
        const layer = document.createElement('div');
        layer.className = 'ndiff-scroll-markers';
        cm.getWrapperElement().appendChild(layer);
        cm.ndiffScrollMarkerLayer = layer;
    }
    return cm.ndiffScrollMarkerLayer;
}

function clearScrollDiffMarkers() {
    allEditors.forEach(cm => {
        if (cm.ndiffScrollAnnotations) {
            scrollMarkerClasses.forEach(className => {
                if (cm.ndiffScrollAnnotations[className]) {
                    cm.ndiffScrollAnnotations[className].update([]);
                }
            });
        }
        if (cm.ndiffScrollMarkerLayer) cm.ndiffScrollMarkerLayer.innerHTML = '';
    });
}

function getScrollAnnotation(cm, className) {
    if (!cm.annotateScrollbar) return null;
    if (!cm.ndiffScrollAnnotations) cm.ndiffScrollAnnotations = {};
    if (!cm.ndiffScrollAnnotations[className]) {
        cm.ndiffScrollAnnotations[className] = cm.annotateScrollbar({className});
    }
    return cm.ndiffScrollAnnotations[className];
}

function getMarkerRange(cm, from, to) {
    const lineCount = cm.lineCount();
    const lastLine = cm.lastLine();
    const start = Math.max(cm.firstLine(), Math.min(from, lastLine));
    let end = Math.max(start, Math.min(to, lineCount));

    if (end === start && start < lastLine) {
        end = start + 1;
    }

    return {
        from: CodeMirror.Pos(start, 0),
        to: end > lastLine ? CodeMirror.Pos(lastLine, cm.getLine(lastLine).length) : CodeMirror.Pos(end, 0)
    };
}

function addAnnotatedScrollMarker(cm, from, to, className) {
    const annotation = getScrollAnnotation(cm, className);
    if (!annotation || !scrollMarkerRanges) return false;

    let rangesByClass = scrollMarkerRanges.get(cm);
    if (!rangesByClass) {
        rangesByClass = new Map();
        scrollMarkerRanges.set(cm, rangesByClass);
    }
    if (!rangesByClass.has(className)) rangesByClass.set(className, []);
    rangesByClass.get(className).push(getMarkerRange(cm, from, to));
    return true;
}

function applyAnnotatedScrollMarkers() {
    if (!scrollMarkerRanges) return;

    scrollMarkerRanges.forEach((rangesByClass, cm) => {
        scrollMarkerClasses.forEach(className => {
            const annotation = getScrollAnnotation(cm, className);
            if (annotation) annotation.update(rangesByClass.get(className) || []);
        });
    });
}

function addScrollDiffMarker(cm, from, to, className) {
    if (!cm) return;

    const maxLine = cm.lineCount();
    const start = Math.max(0, Math.min(from, maxLine));
    const end = Math.max(start, Math.min(to, maxLine));
    const key = `${allEditors.indexOf(cm)}:${start}:${end}:${className}`;
    if (scrollMarkerSeen && scrollMarkerSeen.has(key)) return;
    if (scrollMarkerSeen) scrollMarkerSeen.add(key);

    if (addAnnotatedScrollMarker(cm, start, end, className)) return;

    const lineCount = Math.max(maxLine, 1);
    const marker = document.createElement('div');
    marker.className = `ndiff-scroll-marker ${className}`;
    marker.style.top = `${Math.min((start / lineCount) * 100, 99.5)}%`;
    marker.style.height = end > start ? `${Math.max(((end - start) / lineCount) * 100, 0.6)}%` : '2px';
    getScrollMarkerLayer(cm).appendChild(marker);
}

function addChunkScrollMarkers(leftCM, leftFrom, leftTo, rightCM, rightFrom, rightTo) {
    const hasLeftLines = leftFrom < leftTo;
    const hasRightLines = rightFrom < rightTo;

    if (hasLeftLines && hasRightLines) {
        addScrollDiffMarker(leftCM, leftFrom, leftTo, 'ndiff-scroll-changed');
        addScrollDiffMarker(rightCM, rightFrom, rightTo, 'ndiff-scroll-changed');
    } else if (hasLeftLines) {
        addScrollDiffMarker(leftCM, leftFrom, leftTo, 'ndiff-scroll-deleted');
        addScrollDiffMarker(rightCM, rightFrom, rightTo, 'ndiff-scroll-deleted');
    } else if (hasRightLines) {
        addScrollDiffMarker(leftCM, leftFrom, leftTo, 'ndiff-scroll-inserted');
        addScrollDiffMarker(rightCM, rightFrom, rightTo, 'ndiff-scroll-inserted');
    }
}

function updateMergeViewScrollMarkers() {
    if (!editorInstance) return;

    if (currentLayout === 2 && editorInstance.right) {
        (editorInstance.right.chunks || []).forEach(chunk => {
            addChunkScrollMarkers(
                editorInstance.edit, chunk.editFrom, chunk.editTo,
                editorInstance.right.orig, chunk.origFrom, chunk.origTo
            );
        });
    } else if (currentLayout === 3) {
        if (editorInstance.left) {
            (editorInstance.left.chunks || []).forEach(chunk => {
                addChunkScrollMarkers(
                    editorInstance.edit, chunk.editFrom, chunk.editTo,
                    editorInstance.left.orig, chunk.origFrom, chunk.origTo
                );
            });
        }
        if (editorInstance.right) {
            (editorInstance.right.chunks || []).forEach(chunk => {
                addChunkScrollMarkers(
                    editorInstance.edit, chunk.editFrom, chunk.editTo,
                    editorInstance.right.orig, chunk.origFrom, chunk.origTo
                );
            });
        }
    }
}

function updateMultiColumnScrollMarkers() {
    for (let index = 1; index < allEditors.length; index++) {
        (columnChunks[index] || []).forEach(chunk => {
            addChunkScrollMarkers(
                allEditors[0], chunk.origFrom, chunk.origTo,
                allEditors[index], chunk.editFrom, chunk.editTo
            );
        });
    }
}

function updateScrollDiffMarkers() {
    clearScrollDiffMarkers();
    scrollMarkerSeen = new Set();
    scrollMarkerRanges = new Map();
    if (currentLayout >= 4) updateMultiColumnScrollMarkers();
    else updateMergeViewScrollMarkers();
    applyAnnotatedScrollMarkers();
    scrollMarkerSeen = null;
    scrollMarkerRanges = null;
}

function addMultiColumnSpacer(cm, boundary, rows) {
    if (!cm || rows <= 0) return;

    const node = document.createElement('div');
    node.className = 'ndiff-align-spacer';
    node.style.height = `${rows * cm.defaultTextHeight()}px`;

    let line = boundary;
    let options = {noHScroll: true, coverGutter: false};
    if (line <= cm.firstLine()) {
        line = cm.firstLine();
        options.above = true;
    } else if (line > cm.lastLine()) {
        line = cm.lastLine();
    } else {
        options.above = true;
    }

    multiColumnSpacers.push(cm.addLineWidget(line, node, options));
}

function baseBoundaryToPaneBoundary(index, boundary, isRangeEnd) {
    if (index === 0) return boundary;
    return mapLineBoundary(columnChunks[index], boundary, true, isRangeEnd);
}

function applyInsertionAlignment(boundary, chunksByPane) {
    const rows = Array(allEditors.length).fill(0);
    for (let index = 1; index < allEditors.length; index++) {
        const chunk = chunksByPane[index];
        if (chunk) rows[index] = chunk.editTo - chunk.editFrom;
    }

    const maxRows = Math.max(...rows);
    if (maxRows === 0) return;

    addMultiColumnSpacer(allEditors[0], boundary, maxRows);
    for (let index = 1; index < allEditors.length; index++) {
        const chunk = chunksByPane[index];
        const paneBoundary = chunk ? chunk.editTo : baseBoundaryToPaneBoundary(index, boundary, false);
        addMultiColumnSpacer(allEditors[index], paneBoundary, maxRows - rows[index]);
    }
}

function applyRangeAlignment(origFrom, origTo, chunksByPane) {
    const baseRows = origTo - origFrom;
    const rows = Array(allEditors.length).fill(baseRows);
    const boundaries = Array(allEditors.length).fill(null);
    boundaries[0] = origTo;

    for (let index = 1; index < allEditors.length; index++) {
        const chunk = chunksByPane[index];
        if (chunk) {
            rows[index] = chunk.editTo - chunk.editFrom;
            boundaries[index] = chunk.editTo;
        } else {
            boundaries[index] = baseBoundaryToPaneBoundary(index, origTo, true);
        }
    }

    const maxRows = Math.max(...rows);
    if (maxRows <= baseRows && rows.every(rowCount => rowCount === maxRows)) return;

    for (let index = 0; index < allEditors.length; index++) {
        addMultiColumnSpacer(allEditors[index], boundaries[index], maxRows - rows[index]);
    }
}

function applyMultiColumnAlignment() {
    clearMultiColumnSpacers();
    if (currentLayout < 4 || allEditors.length < 4) return;

    const insertionGroups = new Map();
    const rangeGroups = new Map();

    for (let index = 1; index < allEditors.length; index++) {
        (columnChunks[index] || []).forEach(chunk => {
            const origLen = chunk.origTo - chunk.origFrom;
            const editLen = chunk.editTo - chunk.editFrom;
            if (origLen === 0 && editLen === 0) return;

            if (origLen === 0) {
                const key = String(chunk.origFrom);
                if (!insertionGroups.has(key)) insertionGroups.set(key, Array(allEditors.length).fill(null));
                insertionGroups.get(key)[index] = chunk;
            } else {
                const key = `${chunk.origFrom}:${chunk.origTo}`;
                if (!rangeGroups.has(key)) rangeGroups.set(key, Array(allEditors.length).fill(null));
                rangeGroups.get(key)[index] = chunk;
            }
        });
    }

    [...insertionGroups.entries()]
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .forEach(([boundary, chunksByPane]) => applyInsertionAlignment(Number(boundary), chunksByPane));

    [...rangeGroups.entries()]
        .sort((a, b) => {
            const [aFrom] = a[0].split(':').map(Number);
            const [bFrom] = b[0].split(':').map(Number);
            return aFrom - bFrom;
        })
        .forEach(([range, chunksByPane]) => {
            const [origFrom, origTo] = range.split(':').map(Number);
            applyRangeAlignment(origFrom, origTo, chunksByPane);
        });
}

function applyMultiColumnHighlights() {
    clearMultiColumnHighlights();
    if (currentLayout < 4 || allEditors.length < 4) return;

    const seen = new Set();
    for (let index = 1; index < allEditors.length; index++) {
        const cm = allEditors[index];
        const chunks = columnChunks[index] || [];

        chunks.forEach(chunk => {
            const hasBaseLines = chunk.origFrom < chunk.origTo;
            const hasPaneLines = chunk.editFrom < chunk.editTo;

            if (hasBaseLines && hasPaneLines) {
                addMultiColumnRangeClass(allEditors[0], chunk.origFrom, chunk.origTo, 'ndiff-line-changed', seen);
                addMultiColumnRangeClass(cm, chunk.editFrom, chunk.editTo, 'ndiff-line-changed', seen);
            } else if (hasBaseLines) {
                addMultiColumnRangeClass(allEditors[0], chunk.origFrom, chunk.origTo, 'ndiff-line-deleted', seen);
            } else if (hasPaneLines) {
                addMultiColumnRangeClass(cm, chunk.editFrom, chunk.editTo, 'ndiff-line-inserted', seen);
            }
        });
    }
}

function refreshMultiColumnChunks() {
    if (files.length < 2) return;
    const base = files[0].content;
    columnChunks = [null];
    for (let i = 1; i < allEditors.length; i++) {
        if (files[i]) columnChunks[i] = getLineChunks(base, files[i].content);
        else columnChunks[i] = [];
    }
    applyMultiColumnAlignment();
    applyMultiColumnHighlights();
    updateScrollDiffMarkers();
}

function initMultiColumnView() {
    const container = document.getElementById('editor-container');
    const layout = document.createElement('div');
    layout.className = 'multi-column-layout';
    container.appendChild(layout);

    const mode = getMode(files[0]?.path);
    const theme = getTheme();

    for (let i = 0; i < files.length; i++) {
        const pane = document.createElement('div');
        layout.appendChild(pane);

        const cm = CodeMirror(pane, {
            value: files[i]?.content || '',
            lineNumbers: true, mode: mode, theme: theme
        });
        setupEditor(cm, i);
    }
    allEditors.forEach((cm, index) => {
        cm.on('scroll', (instance) => {
            const info = instance.getScrollInfo();
            allEditors.forEach((other, otherIndex) => {
                if (index !== otherIndex) other.scrollTo(info.left, info.top);
            });
        });
    });

    refreshMultiColumnChunks();
}

function mapLineBoundary(chunks, line, fromOrig, isRangeEnd) {
    if (!chunks || chunks.length === 0) return line;
    let offset = 0;
    for (let c of chunks) {
        const sourceFrom = fromOrig ? c.origFrom : c.editFrom;
        const sourceTo = fromOrig ? c.origTo : c.editTo;
        const targetFrom = fromOrig ? c.editFrom : c.origFrom;
        const targetTo = fromOrig ? c.editTo : c.origTo;

        if (line < sourceFrom) return line + offset;
        if (line <= sourceTo) {
            if (sourceFrom === sourceTo) return isRangeEnd ? targetTo : targetFrom;
            if (line === sourceFrom) return targetFrom;
            if (line === sourceTo) return targetTo;
            return isRangeEnd ? targetTo : targetFrom;
        }
        offset = targetTo - sourceTo;
    }
    return line + offset;
}

function selectedLineRange(cm) {
    const from = cm.getCursor('from');
    const to = cm.getCursor('to');
    const end = to.ch === 0 && to.line > from.line ? to.line : to.line + 1;
    return {start: from.line, end};
}

function lineBoundaryPos(cm, line) {
    if (line >= cm.lineCount()) {
        const lastLine = cm.lastLine();
        return {line: lastLine, ch: cm.getLine(lastLine).length};
    }
    return {line, ch: 0};
}

function clearCurrentLineMarker() {
    if (!currentLineMarker) return;
    currentLineMarker.cm.removeLineClass(currentLineMarker.line, 'background', 'ndiff-current-line');
    currentLineMarker = null;
}

function updateCurrentLineMarker() {
    clearCurrentLineMarker();
    if (isEditMode || !activeCM) return;

    const line = currentLine(activeCM);
    activeCM.addLineClass(line, 'background', 'ndiff-current-line');
    currentLineMarker = {cm: activeCM, line};
}

function currentLine(cm) {
    const range = selectedLineRange(cm);
    const head = cm.getCursor('head');
    let line = head.line;

    if (head.ch === 0 && line === range.end && line > range.start) {
        line -= 1;
    }

    return Math.max(range.start, Math.min(line, range.end - 1));
}

function selectLine(cm, line, scroll = true) {
    const lineCount = cm.lineCount();
    const firstLine = cm.firstLine();
    const lastLine = cm.lastLine();
    const clampedLine = Math.max(firstLine, Math.min(line, lastLine));

    cm.setSelection(
        lineBoundaryPos(cm, Math.min(clampedLine + 1, lineCount)),
        {line: clampedLine, ch: 0},
        {scroll}
    );

    updateCurrentLineMarker();
}

function orientLineModeSelectionForShift(cm, keyCode) {
    const range = selectedLineRange(cm);
    if (range.end - range.start !== 1) return;

    if (keyCode === 40) { // Down
        cm.setSelection(
            {line: range.start, ch: 0},
            lineBoundaryPos(cm, range.end),
            {scroll: false}
        );
    } else { // Up
        cm.setSelection(
            lineBoundaryPos(cm, range.end),
            {line: range.start, ch: 0},
            {scroll: false}
        );
    }
}

function mapSelectionToPane(sourceIndex, targetIndex, sourceRange) {
    if (currentLayout >= 4) {
        const baseStart = sourceIndex === 0 ? sourceRange.start : mapLineBoundary(columnChunks[sourceIndex], sourceRange.start, false, false);
        const baseEnd = sourceIndex === 0 ? sourceRange.end : mapLineBoundary(columnChunks[sourceIndex], sourceRange.end, false, true);

        return {
            start: targetIndex === 0 ? baseStart : mapLineBoundary(columnChunks[targetIndex], baseStart, true, false),
            end: targetIndex === 0 ? baseEnd : mapLineBoundary(columnChunks[targetIndex], baseEnd, true, true)
        };
    }

    if (currentLayout === 2) {
        const dv = editorInstance.right;
        const fromOrig = sourceIndex === 1;
        return {
            start: mapLineBoundary(dv.chunks, sourceRange.start, fromOrig, false),
            end: mapLineBoundary(dv.chunks, sourceRange.end, fromOrig, true)
        };
    }

    let dv, fromOrig;
    if (sourceIndex === 0) {
        dv = editorInstance.left;
        fromOrig = true;
    } else if (sourceIndex === 2) {
        dv = editorInstance.right;
        fromOrig = true;
    } else {
        dv = targetIndex === 0 ? editorInstance.left : editorInstance.right;
        fromOrig = false;
    }

    return {
        start: mapLineBoundary(dv.chunks, sourceRange.start, fromOrig, false),
        end: mapLineBoundary(dv.chunks, sourceRange.end, fromOrig, true)
    };
}

function moveLineModeSelection(keyCode) {
    if (!activeCM) return;

    const line = currentLine(activeCM);

    if (keyCode === 38 || keyCode === 40) { // Up or Down
        const delta = keyCode === 38 ? -1 : 1;
        selectLine(activeCM, line + delta);
        return;
    }

    const currentIndex = allEditors.indexOf(activeCM);
    const targetIndex = keyCode === 37 ? currentIndex - 1 : currentIndex + 1; // Left or Right
    if (targetIndex < 0 || targetIndex >= allEditors.length) return;

    const targetCM = allEditors[targetIndex];
    const targetRange = mapSelectionToPane(currentIndex, targetIndex, {start: line, end: line + 1});
    selectLine(targetCM, targetRange.start);
    clearOtherSelections(targetCM);
    targetCM.focus();
}

function moveSelectedLines(direction) {
    if (!activeCM) return;

    // Issue 3: If in Edit Mode, switch back to Select Mode first
    if (isEditMode) {
        setMode(false);
    }
    
    const currentIndex = allEditors.indexOf(activeCM);
    let targetIndex = (direction === 'left') ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= allEditors.length) return;
    
    const targetCM = allEditors[targetIndex];
    const sourceRange = selectedLineRange(activeCM);
    const targetRange = mapSelectionToPane(currentIndex, targetIndex, sourceRange);
    const targetStart = targetRange.start;
    const targetEnd = targetRange.end;

    const text = activeCM.getRange(lineBoundaryPos(activeCM, sourceRange.start), lineBoundaryPos(activeCM, sourceRange.end));
    targetCM.replaceRange(text, lineBoundaryPos(targetCM, targetStart), lineBoundaryPos(targetCM, targetEnd));
    
    const newEndLine = targetStart + (sourceRange.end - sourceRange.start);
    // Reverse selection: anchor at bottom, head at top (ch 0)
    targetCM.setSelection(
        lineBoundaryPos(targetCM, newEndLine),
        {line: targetStart, ch: 0}
    );
    clearOtherSelections(targetCM);
    targetCM.focus();
}

function getMode(path) {
    if (!path) return 'javascript';
    const ext = path.split('.').pop().toLowerCase();
    const modes = {'js':'javascript','ts':'javascript','html':'htmlmixed','css':'css','py':'python','md':'markdown','json':'javascript','xml':'xml'};
    return modes[ext] || 'javascript';
}

function updateFileInfo() {
    const info = document.getElementById('file-info');
    if (!info) return;

    info.replaceChildren();

    const mode = document.createElement('span');
    mode.className = isEditMode ? 'mode-indicator mode-indicator-edit' : 'mode-indicator';
    mode.innerText = isEditMode ? 'EDIT' : 'SELECT';
    info.appendChild(mode);

    if (files.length === 0) {
        const empty = document.createElement('span');
        empty.innerText = 'No files loaded.';
        info.appendChild(empty);
        return;
    }

    const fileList = document.createElement('span');
    fileList.className = 'file-list';
    files.forEach(file => {
        const item = document.createElement('span');
        item.className = 'file-path';
        item.title = file.path;

        if (file.modified) {
            const marker = document.createElement('span');
            marker.className = 'file-modified-marker';
            marker.innerText = '*';
            item.appendChild(marker);
        }

        const path = document.createElement('span');
        path.className = 'file-path-text';
        path.innerText = file.path;
        item.appendChild(path);
        fileList.appendChild(item);
    });
    info.appendChild(fileList);
}

async function saveResult() {
    const index = allEditors.indexOf(activeCM);
    const file = files[index];
    if (!file) return;

    try {
        file.content = activeCM.getValue();
        await Neutralino.filesystem.writeFile(file.path, file.content);
        file.originalContent = file.content;
        file.modified = false;
        updateFileInfo();
    } catch (err) {
        console.error('Save failed:', err);
    }
}

async function handleWindowClose() {
    const modifiedFiles = files.filter(f => f.modified);
    if (modifiedFiles.length === 0) {
        Neutralino.app.exit();
        return;
    }

    const modal = document.getElementById('save-modal');
    const list = document.getElementById('modified-files-list');
    list.innerHTML = '';

    modifiedFiles.forEach((file, i) => {
        const div = document.createElement('div');
        div.className = 'file-item';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `file-cb-${i}`;
        checkbox.checked = true;
        checkbox.dataset.path = file.path;
        
        const label = document.createElement('label');
        label.htmlFor = `file-cb-${i}`;
        label.innerText = file.path.split('/').pop();
        
        div.appendChild(checkbox);
        div.appendChild(label);
        list.appendChild(div);
    });

    modal.style.display = 'flex';

    document.getElementById('modal-save-btn').onclick = async () => {
        const checkboxes = list.querySelectorAll('input[type="checkbox"]');
        for (let cb of checkboxes) {
            if (cb.checked) {
                const path = cb.dataset.path;
                const file = files.find(f => f.path === path);
                if (file) {
                    try {
                        await Neutralino.filesystem.writeFile(path, file.content);
                    } catch (err) {
                        console.error(`Failed to save ${path}:`, err);
                    }
                }
            }
        }
        Neutralino.app.exit();
    };

    document.getElementById('modal-discard-btn').onclick = () => {
        Neutralino.app.exit();
    };

    document.getElementById('modal-cancel-btn').onclick = () => {
        modal.style.display = 'none';
    };
}
