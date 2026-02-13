#!/usr/bin/env node
/**
 * Weekly Archive Stats Report
 * 
 * Generates a formatted stats report for Telegram delivery.
 * Tracks growth and projects annual size.
 */

const { MessageArchive } = require('../lib/archive-db');
const fs = require('fs');
const path = require('path');
const os = require('os');

const STATS_HISTORY_FILE = path.join(os.homedir(), '.openclaw', 'archive', 'stats-history.json');

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function getDbSize() {
    const dbPath = path.join(os.homedir(), '.openclaw', 'archive', 'messages.db');
    try {
        const stats = fs.statSync(dbPath);
        return stats.size;
    } catch (e) {
        return 0;
    }
}

function loadHistory() {
    try {
        if (fs.existsSync(STATS_HISTORY_FILE)) {
            return JSON.parse(fs.readFileSync(STATS_HISTORY_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('Error loading history:', e.message);
    }
    return { reports: [] };
}

function saveHistory(history) {
    try {
        const dir = path.dirname(STATS_HISTORY_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(STATS_HISTORY_FILE, JSON.stringify(history, null, 2));
    } catch (e) {
        console.error('Error saving history:', e.message);
    }
}

function generateReport() {
    const archive = new MessageArchive();
    const dbSize = getDbSize();
    const history = loadHistory();
    
    // Get current counts
    const messageCounts = archive.db.prepare(`
        SELECT 
            channel,
            COUNT(*) as count
        FROM messages
        GROUP BY channel
        ORDER BY count DESC
    `).all();
    
    const totalMessages = messageCounts.reduce((sum, row) => sum + row.count, 0);
    
    const eventCount = archive.db.prepare('SELECT COUNT(*) as count FROM events').get().count;
    
    const sessionCount = archive.db.prepare('SELECT COUNT(DISTINCT session_id) as count FROM messages WHERE session_id IS NOT NULL').get().count;
    
    // Calculate growth
    const lastWeekReport = history.reports.length > 0 ? history.reports[history.reports.length - 1] : null;
    const growth = lastWeekReport ? dbSize - lastWeekReport.dbSize : 0;
    const growthMB = growth / (1024 * 1024);
    
    // Project annual size
    const daysInWeek = 7;
    const weeksInYear = 52;
    const annualGrowthMB = growthMB * weeksInYear;
    const projectedAnnualSize = (dbSize / (1024 * 1024)) + annualGrowthMB;
    
    // Save current report to history
    const currentReport = {
        timestamp: Date.now(),
        dbSize: dbSize,
        totalMessages: totalMessages,
        eventCount: eventCount,
        sessionCount: sessionCount
    };
    history.reports.push(currentReport);
    
    // Keep last 26 weeks (6 months)
    if (history.reports.length > 26) {
        history.reports = history.reports.slice(-26);
    }
    saveHistory(history);
    
    // Format output for Telegram
    const report = `📊 *Weekly Archive Stats Report*

*Current Status:*
🗄️ Database size: ${formatBytes(dbSize)}
💬 Total messages: ${totalMessages.toLocaleString()}
📋 Total events: ${eventCount.toLocaleString()}
🔗 Sessions tracked: ${sessionCount.toLocaleString()}

*Growth (past week):*
${lastWeekReport ? `📈 Size increased by: ${formatBytes(growth)} (+${growthMB.toFixed(2)} MB)` : '📈 First report - no growth data yet'}

*Projections:*
📅 Estimated annual growth: ${annualGrowthMB.toFixed(1)} MB/year
🎯 Projected size (1 year): ${projectedAnnualSize.toFixed(1)} MB

*Top Channels:*
${messageCounts.slice(0, 5).map(row => `• ${row.channel}: ${row.count.toLocaleString()} messages`).join('\n')}`;

    console.log(report);
    return report;
}

// Run if called directly
if (require.main === module) {
    try {
        generateReport();
    } catch (error) {
        console.error('Error generating report:', error);
        process.exit(1);
    }
}

module.exports = { generateReport };
