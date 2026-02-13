/**
 * Session Detector - Extract session metadata from JSONL files
 * 
 * Analyzes session files to determine:
 * - Session type (main/subagent/cron/isolated)
 * - Session key and parent relationships
 * - Timing and model information
 * - Event counts
 * 
 * @module session-detector
 */

const fs = require('fs');
const readline = require('readline');
const path = require('path');

class SessionDetector {
    constructor() {}

    /**
     * Detect session metadata from a JSONL file
     * @param {string} sessionFilePath - Path to session file
     * @returns {Promise<object>} Session metadata
     */
    async detectSession(sessionFilePath) {
        const filename = path.basename(sessionFilePath, '.jsonl');
        const sessionId = filename;

        let firstEvent = null;
        let lastEvent = null;
        let sessionEvent = null;
        let modelChangeEvent = null;
        let messageCount = 0;
        let eventCount = 0;

        const fileStream = fs.createReadStream(sessionFilePath);
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });

        for await (const line of rl) {
            if (!line.trim()) continue;

            try {
                const event = JSON.parse(line);
                eventCount++;

                if (!firstEvent) {
                    firstEvent = event;
                }
                lastEvent = event;

                // Capture session init event
                if (event.type === 'session') {
                    sessionEvent = event;
                }

                // Capture first model change
                if (event.type === 'model_change' && !modelChangeEvent) {
                    modelChangeEvent = event;
                }

                // Count messages
                if (event.type === 'message') {
                    messageCount++;
                }
            } catch (error) {
                // Skip malformed lines
            }
        }

        if (!firstEvent) {
            throw new Error(`No events found in ${sessionFilePath}`);
        }

        // Determine session type and key
        const { type, sessionKey, parentId, label, agentId } = this.classifySession(
            sessionFilePath,
            sessionEvent,
            firstEvent
        );

        // Extract timestamps (handle both 'timestamp' and 'ts' fields)
        const firstTimestamp = firstEvent.timestamp || firstEvent.ts;
        const lastTimestamp = lastEvent ? (lastEvent.timestamp || lastEvent.ts) : null;
        
        if (!firstTimestamp) {
            throw new Error(`No timestamp found in first event of ${sessionFilePath}`);
        }
        
        const startedAt = new Date(firstTimestamp).getTime();
        const endedAt = lastTimestamp ? new Date(lastTimestamp).getTime() : null;

        // Determine status
        const status = this.determineStatus(sessionFilePath, endedAt);

        // Extract model
        const model = modelChangeEvent ? modelChangeEvent.modelId : null;

        return {
            id: sessionId,
            session_key: sessionKey,
            type,
            parent_id: parentId,
            label,
            agent_id: agentId,
            model,
            started_at: startedAt,
            ended_at: endedAt,
            status,
            message_count: messageCount,
            event_count: eventCount
        };
    }

    /**
     * Classify session type and extract metadata
     */
    classifySession(filePath, sessionEvent, firstEvent) {
        const dirPath = path.dirname(filePath);
        const dirName = path.basename(dirPath);

        let type = 'isolated';
        let sessionKey = 'unknown';
        let parentId = null;
        let label = null;
        let agentId = null;

        // Check if it's a cron job
        if (dirPath.includes('/cron/runs')) {
            type = 'cron';
            sessionKey = 'cron';
            
            // Try to extract label from file metadata
            if (sessionEvent && sessionEvent.label) {
                label = sessionEvent.label;
            }
        }
        // Check if it's main agent session
        else if (dirPath.includes('/agents/main/sessions')) {
            agentId = 'main';
            
            // Check if it's a subagent by looking at the session key or parent
            if (firstEvent.parentId || (sessionEvent && sessionEvent.parentId)) {
                type = 'subagent';
                parentId = firstEvent.parentId || sessionEvent.parentId;
                sessionKey = `agent:main:subagent:${path.basename(filePath, '.jsonl')}`;
            } else {
                type = 'main';
                sessionKey = 'agent:main:main';
            }

            // Extract label if present
            if (sessionEvent && sessionEvent.label) {
                label = sessionEvent.label;
            }
        }

        return { type, sessionKey, parentId, label, agentId };
    }

    /**
     * Determine session status
     */
    determineStatus(filePath, endedAt) {
        // Check if there's a .lock file (session is active)
        const lockPath = `${filePath}.lock`;
        if (fs.existsSync(lockPath)) {
            return 'active';
        }

        // Check if file is marked as deleted
        if (filePath.includes('.deleted.')) {
            return 'completed';
        }

        // If we have an end time and no lock, it's completed
        if (endedAt) {
            return 'completed';
        }

        return 'active';
    }

    /**
     * Batch detect sessions from multiple files
     * @param {Array<string>} filePaths - Array of session file paths
     * @param {object} options - Options (verbose)
     * @returns {Promise<Array<object>>} Array of session metadata
     */
    async detectBatch(filePaths, options = {}) {
        const { verbose = false } = options;
        const sessions = [];

        for (const filePath of filePaths) {
            try {
                if (verbose) {
                    console.log(`Detecting: ${path.basename(filePath)}`);
                }

                const sessionData = await this.detectSession(filePath);
                sessions.push(sessionData);
            } catch (error) {
                if (verbose) {
                    console.error(`Failed to detect ${filePath}: ${error.message}`);
                }
            }
        }

        return sessions;
    }

    /**
     * Find all session files in a directory tree
     * @param {string} searchDir - Directory to search (defaults to ~/.openclaw)
     * @returns {Promise<Array<string>>} Array of session file paths
     */
    async findSessionFiles(searchDir = null) {
        const baseDir = searchDir || path.join(process.env.HOME, '.openclaw');
        const sessionFiles = [];

        // Search in agents/*/sessions/
        const agentsDir = path.join(baseDir, 'agents');
        if (fs.existsSync(agentsDir)) {
            const agents = fs.readdirSync(agentsDir);
            for (const agent of agents) {
                const sessionsDir = path.join(agentsDir, agent, 'sessions');
                if (fs.existsSync(sessionsDir)) {
                    const files = fs.readdirSync(sessionsDir)
                        .filter(f => f.endsWith('.jsonl') && !f.includes('.lock'))
                        .map(f => path.join(sessionsDir, f));
                    sessionFiles.push(...files);
                }
            }
        }

        // Search in cron/runs/
        const cronDir = path.join(baseDir, 'cron', 'runs');
        if (fs.existsSync(cronDir)) {
            const files = fs.readdirSync(cronDir)
                .filter(f => f.endsWith('.jsonl') && !f.includes('.lock'))
                .map(f => path.join(cronDir, f));
            sessionFiles.push(...files);
        }

        return sessionFiles;
    }
}

module.exports = { SessionDetector };
