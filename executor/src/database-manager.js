const fs = require('fs').promises;
const path = require('path');

/**
 * DatabaseManager
 * Handles data persistence and logging for the flash bot
 * Uses JSON files for simplicity, can be extended to use proper databases
 */
class DatabaseManager {
  constructor(logger) {
    this.logger = logger;
    this.dataDir = path.join(__dirname, '../data');
    this.isInitialized = false;
    
    // File paths
    this.files = {
      executions: path.join(this.dataDir, 'executions.json'),
      dailyReports: path.join(this.dataDir, 'daily-reports.json'),
      opportunities: path.join(this.dataDir, 'opportunities.json'),
      errors: path.join(this.dataDir, 'errors.json'),
      config: path.join(this.dataDir, 'config.json')
    };
  }

  /**
   * Initialize database
   */
  async initialize() {
    try {
      this.logger.info('💾 Initializing Database Manager...');
      
      // Create data directory if it doesn't exist
      await this.ensureDataDirectory();
      
      // Initialize data files
      await this.initializeDataFiles();
      
      this.isInitialized = true;
      this.logger.info('✅ Database Manager initialized successfully');
    } catch (error) {
      this.logger.error('❌ Failed to initialize Database Manager:', error);
      throw error;
    }
  }

  /**
   * Ensure data directory exists
   */
  async ensureDataDirectory() {
    try {
      await fs.access(this.dataDir);
    } catch {
      await fs.mkdir(this.dataDir, { recursive: true });
      this.logger.info('📁 Created data directory:', this.dataDir);
    }
  }

  /**
   * Initialize data files
   */
  async initializeDataFiles() {
    const defaultData = {
      executions: [],
      dailyReports: [],
      opportunities: [],
      errors: [],
      config: {
        version: '1.0.0',
        created: new Date().toISOString(),
        lastUpdate: new Date().toISOString()
      }
    };

    for (const [key, filePath] of Object.entries(this.files)) {
      try {
        await fs.access(filePath);
        this.logger.debug(`📄 Found existing file: ${key}`);
      } catch {
        await fs.writeFile(filePath, JSON.stringify(defaultData[key], null, 2));
        this.logger.info(`📄 Created new file: ${key}`);
      }
    }
  }

  /**
   * Read data from file
   */
  async readData(dataType) {
    try {
      const filePath = this.files[dataType];
      if (!filePath) {
        throw new Error(`Unknown data type: ${dataType}`);
      }

      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      this.logger.error(`Error reading ${dataType} data:`, error);
      return [];
    }
  }

  /**
   * Write data to file
   */
  async writeData(dataType, data) {
    try {
      const filePath = this.files[dataType];
      if (!filePath) {
        throw new Error(`Unknown data type: ${dataType}`);
      }

      await fs.writeFile(filePath, JSON.stringify(data, null, 2));
      this.logger.debug(`💾 Saved ${dataType} data`);
    } catch (error) {
      this.logger.error(`Error writing ${dataType} data:`, error);
      throw error;
    }
  }

  /**
   * Append data to file
   */
  async appendData(dataType, newData) {
    try {
      const existingData = await this.readData(dataType);
      existingData.push(newData);
      
      // Keep only last 10000 records to prevent files from growing too large
      if (existingData.length > 10000) {
        existingData.splice(0, existingData.length - 10000);
      }
      
      await this.writeData(dataType, existingData);
    } catch (error) {
      this.logger.error(`Error appending to ${dataType}:`, error);
      throw error;
    }
  }

  /**
   * Log execution result
   */
  async logExecution(executionData) {
    try {
      const execution = {
        id: this.generateId(),
        timestamp: new Date().toISOString(),
        ...executionData
      };

      await this.appendData('executions', execution);
      this.logger.info('📝 Execution logged:', execution.id);
      
      return execution.id;
    } catch (error) {
      this.logger.error('Error logging execution:', error);
      throw error;
    }
  }

  /**
   * Log arbitrage opportunity
   */
  async logOpportunity(opportunityData) {
    try {
      const opportunity = {
        id: this.generateId(),
        timestamp: new Date().toISOString(),
        ...opportunityData
      };

      await this.appendData('opportunities', opportunity);
      this.logger.debug('📝 Opportunity logged:', opportunity.id);
      
      return opportunity.id;
    } catch (error) {
      this.logger.error('Error logging opportunity:', error);
      throw error;
    }
  }

  /**
   * Log error
   */
  async logError(errorData) {
    try {
      const error = {
        id: this.generateId(),
        timestamp: new Date().toISOString(),
        ...errorData
      };

      await this.appendData('errors', error);
      this.logger.debug('📝 Error logged:', error.id);
      
      return error.id;
    } catch (error) {
      this.logger.error('Error logging error:', error);
      throw error;
    }
  }

  /**
   * Save daily report
   */
  async saveDailyReport(reportData) {
    try {
      const report = {
        id: this.generateId(),
        timestamp: new Date().toISOString(),
        ...reportData
      };

      await this.appendData('dailyReports', report);
      this.logger.info('📊 Daily report saved:', report.date);
      
      return report.id;
    } catch (error) {
      this.logger.error('Error saving daily report:', error);
      throw error;
    }
  }

  /**
   * Get executions with filters
   */
  async getExecutions(filters = {}) {
    try {
      const executions = await this.readData('executions');
      
      return this.applyFilters(executions, filters);
    } catch (error) {
      this.logger.error('Error getting executions:', error);
      return [];
    }
  }

  /**
   * Get opportunities with filters
   */
  async getOpportunities(filters = {}) {
    try {
      const opportunities = await this.readData('opportunities');
      
      return this.applyFilters(opportunities, filters);
    } catch (error) {
      this.logger.error('Error getting opportunities:', error);
      return [];
    }
  }

  /**
   * Get daily reports
   */
  async getDailyReports(limit = 30) {
    try {
      const reports = await this.readData('dailyReports');
      
      return reports
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, limit);
    } catch (error) {
      this.logger.error('Error getting daily reports:', error);
      return [];
    }
  }

  /**
   * Get errors with filters
   */
  async getErrors(filters = {}) {
    try {
      const errors = await this.readData('errors');
      
      return this.applyFilters(errors, filters);
    } catch (error) {
      this.logger.error('Error getting errors:', error);
      return [];
    }
  }

  /**
   * Apply filters to data
   */
  applyFilters(data, filters) {
    let filtered = [...data];

    // Date range filter
    if (filters.startDate) {
      const startDate = new Date(filters.startDate);
      filtered = filtered.filter(item => new Date(item.timestamp) >= startDate);
    }

    if (filters.endDate) {
      const endDate = new Date(filters.endDate);
      filtered = filtered.filter(item => new Date(item.timestamp) <= endDate);
    }

    // Success filter
    if (filters.success !== undefined) {
      filtered = filtered.filter(item => item.success === filters.success);
    }

    // Asset filter
    if (filters.asset) {
      filtered = filtered.filter(item => item.asset === filters.asset);
    }

    // Limit
    if (filters.limit) {
      filtered = filtered.slice(0, filters.limit);
    }

    // Sort by timestamp (newest first)
    filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return filtered;
  }

  /**
   * Get statistics
   */
  async getStatistics() {
    try {
      const [executions, opportunities, errors] = await Promise.all([
        this.readData('executions'),
        this.readData('opportunities'),
        this.readData('errors')
      ]);

      const successfulExecutions = executions.filter(e => e.success);
      const totalProfit = successfulExecutions.reduce((sum, e) => {
        return sum + parseFloat(e.profit || 0);
      }, 0);

      const today = new Date().toISOString().split('T')[0];
      const todayExecutions = executions.filter(e => e.timestamp.startsWith(today));
      const todayOpportunities = opportunities.filter(o => o.timestamp.startsWith(today));
      const todayErrors = errors.filter(e => e.timestamp.startsWith(today));

      return {
        total: {
          executions: executions.length,
          successfulExecutions: successfulExecutions.length,
          opportunities: opportunities.length,
          errors: errors.length,
          totalProfit: totalProfit.toFixed(6)
        },
        today: {
          executions: todayExecutions.length,
          opportunities: todayOpportunities.length,
          errors: todayErrors.length
        },
        successRate: executions.length > 0 ? 
          (successfulExecutions.length / executions.length * 100).toFixed(2) + '%' : '0%'
      };
    } catch (error) {
      this.logger.error('Error getting statistics:', error);
      return null;
    }
  }

  /**
   * Clean old data
   */
  async cleanOldData(daysToKeep = 30) {
    try {
      this.logger.info(`🧹 Cleaning data older than ${daysToKeep} days...`);
      
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      const dataTypes = ['executions', 'opportunities', 'errors'];
      
      for (const dataType of dataTypes) {
        const data = await this.readData(dataType);
        const filteredData = data.filter(item => 
          new Date(item.timestamp) >= cutoffDate
        );
        
        if (filteredData.length < data.length) {
          await this.writeData(dataType, filteredData);
          this.logger.info(`🧹 Cleaned ${data.length - filteredData.length} old ${dataType} records`);
        }
      }
      
      this.logger.info('✅ Data cleanup completed');
    } catch (error) {
      this.logger.error('Error cleaning old data:', error);
      throw error;
    }
  }

  /**
   * Backup data
   */
  async backupData() {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupDir = path.join(this.dataDir, 'backups', timestamp);
      
      await fs.mkdir(backupDir, { recursive: true });
      
      for (const [dataType, filePath] of Object.entries(this.files)) {
        const backupPath = path.join(backupDir, `${dataType}.json`);
        await fs.copyFile(filePath, backupPath);
      }
      
      this.logger.info('💾 Data backup created:', backupDir);
      return backupDir;
    } catch (error) {
      this.logger.error('Error creating backup:', error);
      throw error;
    }
  }

  /**
   * Export data to CSV
   */
  async exportToCSV(dataType, filePath) {
    try {
      const data = await this.readData(dataType);
      
      if (data.length === 0) {
        throw new Error(`No data found for ${dataType}`);
      }

      // Get headers from first object
      const headers = Object.keys(data[0]);
      
      // Create CSV content
      let csvContent = headers.join(',') + '\n';
      
      for (const row of data) {
        const values = headers.map(header => {
          const value = row[header];
          // Escape commas and quotes
          if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return value || '';
        });
        csvContent += values.join(',') + '\n';
      }
      
      await fs.writeFile(filePath, csvContent);
      this.logger.info('📊 Data exported to CSV:', filePath);
      
      return filePath;
    } catch (error) {
      this.logger.error('Error exporting to CSV:', error);
      throw error;
    }
  }

  /**
   * Generate unique ID
   */
  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  /**
   * Get database status
   */
  getStatus() {
    return {
      initialized: this.isInitialized,
      dataDir: this.dataDir,
      files: this.files
    };
  }

  /**
   * Close database connections
   */
  async close() {
    try {
      // In a real database implementation, this would close connections
      this.logger.info('💾 Database Manager closed');
    } catch (error) {
      this.logger.error('Error closing database:', error);
    }
  }
}

module.exports = DatabaseManager;

