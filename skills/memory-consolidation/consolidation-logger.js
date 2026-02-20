#!/usr/bin/env node

/**
 * Nightly Consolidation Post-Processor
 * 
 * Organizes consolidation outputs into dated directories and manages MEMORY.md size.
 * Run after the nightly synthesis job completes.
 * 
 * Usage: node consolidation-logger.js [--date YYYY-MM-DD]
 */

const fs = require('fs');
const path = require('path');

const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/Users/sam/.openclaw/workspace';
const MEMORY_DIR = path.join(WORKSPACE_DIR, 'memory');
const LOGS_DIR = path.join(WORKSPACE_DIR, 'logs', 'consolidation');
const MEMORY_FILE = path.join(WORKSPACE_DIR, 'MEMORY.md');
const SUMMARIES_DIR = path.join(MEMORY_DIR, 'summaries');
const DREAM_NOTES = path.join(MEMORY_DIR, 'dream-notes.md');

// Maximum size for MEMORY.md (50KB)
const MAX_MEMORY_SIZE = 50 * 1024;

function getTargetDate() {
    const args = process.argv.slice(2);
    const dateIndex = args.indexOf('--date');
    if (dateIndex !== -1 && args[dateIndex + 1]) {
        return args[dateIndex + 1];
    }
    
    // Default to today in JST (the consolidation runs at 2:30 AM JST)
    // At 2:30 AM, we want to use yesterday's date for the directory
    const now = new Date();
    const jstOffset = 9 * 60; // JST is UTC+9
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const jstTime = new Date(utc + (jstOffset * 60000));
    
    // If it's before 3 AM JST, use yesterday's date
    if (jstTime.getHours() < 3) {
        jstTime.setDate(jstTime.getDate() - 1);
    }
    
    return jstTime.toISOString().split('T')[0];
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function getSummariesForWeek(targetDate) {
    const target = new Date(targetDate);
    const summaries = [];
    
    // Get the 7 days BEFORE targetDate (the week that just completed)
    // If target is Feb 20, we want Feb 13-19 (7 days)
    for (let i = 7; i >= 1; i--) {
        const d = new Date(target);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        const summaryPath = path.join(SUMMARIES_DIR, `${dateStr}.summary.md`);
        
        if (fs.existsSync(summaryPath)) {
            summaries.push({
                date: dateStr,
                path: summaryPath,
                content: fs.readFileSync(summaryPath, 'utf-8')
            });
        }
    }
    
    return summaries;
}

function copySummariesToLogDir(logDir, summaries) {
    console.log(`📋 Copying ${summaries.length} summaries to ${logDir}`);
    
    for (const summary of summaries) {
        const destPath = path.join(logDir, `${summary.date}.summary.md`);
        fs.writeFileSync(destPath, summary.content);
        console.log(`  ✓ ${summary.date}.summary.md`);
    }
}

function extractRecentMemoryAdditions(memoryContent, maxEntries = 10) {
    // Find the "##" sections that look like recent entries
    const lines = memoryContent.split('\n');
    const recentEntries = [];
    let inEntry = false;
    let currentEntry = [];
    
    for (const line of lines) {
        // Look for entry headers (typically "## Something" or "### Something")
        if (line.match(/^##\s/)) {
            if (currentEntry.length > 0 && recentEntries.length < maxEntries) {
                recentEntries.push(currentEntry.join('\n'));
            }
            currentEntry = [line];
            inEntry = true;
        } else if (inEntry) {
            currentEntry.push(line);
        }
    }
    
    // Don't forget the last entry
    if (currentEntry.length > 0 && recentEntries.length < maxEntries) {
        recentEntries.push(currentEntry.join('\n'));
    }
    
    return recentEntries;
}

function createConsolidationReport(logDir, targetDate, summaries) {
    const reportPath = path.join(logDir, 'CONSOLIDATION_REPORT.md');
    
    // Get current MEMORY.md stats
    const memoryStats = fs.existsSync(MEMORY_FILE) 
        ? fs.statSync(MEMORY_FILE)
        : { size: 0 };
    
    // Extract recent additions from MEMORY.md
    let memoryAdditions = '*(No additions detected)*';
    if (fs.existsSync(MEMORY_FILE)) {
        const memoryContent = fs.readFileSync(MEMORY_FILE, 'utf-8');
        const recentEntries = extractRecentMemoryAdditions(memoryContent, 5);
        if (recentEntries.length > 0) {
            memoryAdditions = recentEntries.join('\n\n---\n\n');
        }
    }
    
    // Read dream-notes if it exists to extract synthesis themes
    let synthesisThemes = '';
    if (fs.existsSync(DREAM_NOTES)) {
        const dreamContent = fs.readFileSync(DREAM_NOTES, 'utf-8');
        // Extract the date header and first few sections
        const lines = dreamContent.split('\n');
        const headerLines = [];
        let lineCount = 0;
        for (const line of lines) {
            if (lineCount < 50) { // First 50 lines
                headerLines.push(line);
                lineCount++;
            } else if (line.startsWith('##')) {
                break;
            }
        }
        synthesisThemes = headerLines.join('\n');
    }
    
    const report = `# Consolidation Report: ${targetDate}

**Generated:** ${new Date().toISOString()}

## Summary

- **Date Range:** ${summaries[0]?.date || 'N/A'} to ${summaries[summaries.length - 1]?.date || targetDate}
- **Summaries Processed:** ${summaries.length}
- **MEMORY.md Size:** ${(memoryStats.size / 1024).toFixed(1)} KB

## Days Included

${summaries.map(s => `- ${s.date}: ${s.content.split('\n')[0].replace('# Summary: ', '').replace('# ', '')}`).join('\n')}

## Synthesis Themes

${synthesisThemes || '*(See dream-notes.md for full synthesis)*'}

## MEMORY.md Additions

${memoryAdditions}

---

*This report was automatically generated by the nightly consolidation process.*
`;
    
    fs.writeFileSync(reportPath, report);
    console.log(`📝 Consolidation report written to ${reportPath}`);
    
    return reportPath;
}

function manageMemorySize() {
    if (!fs.existsSync(MEMORY_FILE)) {
        return;
    }
    
    const stats = fs.statSync(MEMORY_FILE);
    if (stats.size <= MAX_MEMORY_SIZE) {
        console.log(`✅ MEMORY.md is ${(stats.size / 1024).toFixed(1)} KB (under ${MAX_MEMORY_SIZE / 1024} KB limit)`);
        return;
    }
    
    console.log(`⚠️  MEMORY.md is ${(stats.size / 1024).toFixed(1)} KB, exceeding ${MAX_MEMORY_SIZE / 1024} KB limit`);
    console.log(`   Archiving older entries...`);
    
    // Read current content
    const content = fs.readFileSync(MEMORY_FILE, 'utf-8');
    const lines = content.split('\n');
    
    // Find a good split point (keep top ~60% which is typically the header + recent entries)
    const targetSize = Math.floor(MAX_MEMORY_SIZE * 0.6);
    let currentSize = 0;
    let splitIndex = 0;
    
    for (let i = 0; i < lines.length; i++) {
        currentSize += lines[i].length + 1; // +1 for newline
        if (currentSize >= targetSize && lines[i].match(/^##\s/)) {
            splitIndex = i;
            break;
        }
    }
    
    if (splitIndex === 0) {
        console.log('   Could not find safe split point, skipping archive');
        return;
    }
    
    // Split content
    const keepLines = lines.slice(0, splitIndex);
    const archiveLines = lines.slice(splitIndex);
    
    // Create archive
    const archiveDate = new Date().toISOString().split('T')[0];
    const archiveDir = path.join(MEMORY_DIR, 'archive');
    ensureDir(archiveDir);
    
    const archivePath = path.join(archiveDir, `MEMORY-${archiveDate}-archive.md`);
    fs.writeFileSync(archivePath, archiveLines.join('\n'));
    
    // Update MEMORY.md
    fs.writeFileSync(MEMORY_FILE, keepLines.join('\n'));
    
    const newStats = fs.statSync(MEMORY_FILE);
    console.log(`   ✓ Archived to ${archivePath}`);
    console.log(`   ✓ MEMORY.md reduced to ${(newStats.size / 1024).toFixed(1)} KB`);
}

function main() {
    console.log('🌙 Nightly Consolidation Post-Processor\n');
    
    const targetDate = getTargetDate();
    console.log(`📅 Target Date: ${targetDate}`);
    
    // Create dated directory
    const logDir = path.join(LOGS_DIR, targetDate);
    ensureDir(logDir);
    console.log(`📁 Log Directory: ${logDir}`);
    
    // Get and copy summaries
    const summaries = getSummariesForWeek(targetDate);
    if (summaries.length === 0) {
        console.log('⚠️  No summaries found for this date range');
        process.exit(1);
    }
    
    copySummariesToLogDir(logDir, summaries);
    
    // Create consolidation report
    createConsolidationReport(logDir, targetDate, summaries);
    
    // Manage MEMORY.md size
    manageMemorySize();
    
    console.log('\n✅ Consolidation logging complete');
}

if (require.main === module) {
    main();
}

module.exports = { getSummariesForWeek, manageMemorySize };
