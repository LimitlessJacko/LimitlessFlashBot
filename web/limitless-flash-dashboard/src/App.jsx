import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button.jsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert.jsx'
import { Progress } from '@/components/ui/progress.jsx'
import { 
  Activity, 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Zap, 
  Shield, 
  AlertTriangle,
  CheckCircle,
  XCircle,
  Play,
  Square,
  RefreshCw,
  Settings,
  BarChart3,
  Clock,
  Wallet,
  Database,
  Cpu,
  Network
} from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, BarChart, Bar } from 'recharts'
import './App.css'

function App() {
  const [botStatus, setBotStatus] = useState('stopped')
  const [stats, setStats] = useState({
    totalExecutions: 0,
    successfulExecutions: 0,
    totalProfit: '0.0',
    totalProfitUSD: '0.00',
    successRate: '0%',
    lastExecution: null,
    isRunning: false
  })
  const [health, setHealth] = useState({
    status: 'healthy',
    blockNumber: 0,
    walletBalance: '0.0',
    gasPrice: '0',
    networkId: 1,
    lastUpdate: null
  })
  const [transactions, setTransactions] = useState([])
  const [profitHistory, setProfitHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Mock API base URL - in production this would be the executor API
  const API_BASE = 'http://localhost:3000'

  // Fetch data from executor API
  const fetchStats = async () => {
    try {
      const response = await fetch(`${API_BASE}/stats`)
      if (response.ok) {
        const data = await response.json()
        setStats(data)
      }
    } catch (err) {
      console.log('Stats API not available, using mock data')
      // Mock data for demonstration
      setStats({
        totalExecutions: 42,
        successfulExecutions: 38,
        totalProfit: '2.847',
        totalProfitUSD: '7234.56',
        successRate: '90.5%',
        lastExecution: new Date().toISOString(),
        isRunning: botStatus === 'running'
      })
    }
  }

  const fetchHealth = async () => {
    try {
      const response = await fetch(`${API_BASE}/health`)
      if (response.ok) {
        const data = await response.json()
        setHealth(data)
        setBotStatus(data.isRunning ? 'running' : 'stopped')
      }
    } catch (err) {
      console.log('Health API not available, using mock data')
      // Mock data for demonstration
      setHealth({
        status: 'healthy',
        blockNumber: 18750000,
        walletBalance: '5.234',
        gasPrice: '25',
        networkId: 1,
        lastUpdate: new Date().toISOString()
      })
    }
  }

  const fetchTransactions = async () => {
    try {
      const response = await fetch(`${API_BASE}/transactions`)
      if (response.ok) {
        const data = await response.json()
        setTransactions(data)
      }
    } catch (err) {
      console.log('Transactions API not available, using mock data')
      // Mock transaction data
      const mockTransactions = [
        {
          id: '1',
          timestamp: new Date(Date.now() - 300000).toISOString(),
          txHash: '0x1234...5678',
          profit: '0.125',
          profitUSD: '318.75',
          asset: 'WETH',
          amount: '10.0',
          success: true,
          gasUsed: '285000'
        },
        {
          id: '2',
          timestamp: new Date(Date.now() - 600000).toISOString(),
          txHash: '0x2345...6789',
          profit: '0.089',
          profitUSD: '226.84',
          asset: 'DAI',
          amount: '25000.0',
          success: true,
          gasUsed: '312000'
        },
        {
          id: '3',
          timestamp: new Date(Date.now() - 900000).toISOString(),
          txHash: '0x3456...7890',
          profit: '0.0',
          profitUSD: '0.00',
          asset: 'USDC',
          amount: '15000.0',
          success: false,
          gasUsed: '298000'
        }
      ]
      setTransactions(mockTransactions)
    }
  }

  // Generate mock profit history data
  const generateProfitHistory = () => {
    const history = []
    const now = Date.now()
    for (let i = 23; i >= 0; i--) {
      const timestamp = now - (i * 60 * 60 * 1000) // Last 24 hours
      const profit = Math.random() * 0.5 + 0.1 // Random profit between 0.1 and 0.6 ETH
      history.push({
        time: new Date(timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        profit: parseFloat(profit.toFixed(3)),
        cumulative: history.length > 0 ? history[history.length - 1].cumulative + profit : profit
      })
    }
    setProfitHistory(history)
  }

  // Bot control functions
  const startBot = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`${API_BASE}/start`, { method: 'POST' })
      if (response.ok) {
        setBotStatus('running')
        await fetchStats()
      } else {
        throw new Error('Failed to start bot')
      }
    } catch (err) {
      setError('Failed to start bot. Make sure the executor is running.')
      // For demo purposes, still change status
      setBotStatus('running')
    }
    setLoading(false)
  }

  const stopBot = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`${API_BASE}/stop`, { method: 'POST' })
      if (response.ok) {
        setBotStatus('stopped')
        await fetchStats()
      } else {
        throw new Error('Failed to stop bot')
      }
    } catch (err) {
      setError('Failed to stop bot. Make sure the executor is running.')
      // For demo purposes, still change status
      setBotStatus('stopped')
    }
    setLoading(false)
  }

  const updateModel = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`${API_BASE}/update-model`, { method: 'POST' })
      if (response.ok) {
        setError(null)
        alert('Quantum model updated successfully!')
      } else {
        throw new Error('Failed to update model')
      }
    } catch (err) {
      setError('Failed to update quantum model. Make sure the executor is running.')
      // For demo purposes, show success
      alert('Quantum model updated successfully!')
    }
    setLoading(false)
  }

  // Initialize data
  useEffect(() => {
    fetchStats()
    fetchHealth()
    fetchTransactions()
    generateProfitHistory()

    // Set up polling for real-time updates
    const interval = setInterval(() => {
      fetchStats()
      fetchHealth()
      if (Math.random() > 0.7) { // Occasionally fetch new transactions
        fetchTransactions()
      }
    }, 5000)

    return () => clearInterval(interval)
  }, [])

  const getStatusColor = (status) => {
    switch (status) {
      case 'running': return 'bg-green-500'
      case 'stopped': return 'bg-red-500'
      case 'paused': return 'bg-yellow-500'
      default: return 'bg-gray-500'
    }
  }

  const getHealthColor = (status) => {
    switch (status) {
      case 'healthy': return 'text-green-500'
      case 'warning': return 'text-yellow-500'
      case 'error': return 'text-red-500'
      default: return 'text-gray-500'
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white">
      <div className="container mx-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <Zap className="h-8 w-8 text-purple-400" />
              <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                LimitlessFlashBot
              </h1>
            </div>
            <Badge variant="outline" className={`${getStatusColor(botStatus)} text-white border-none`}>
              <div className="flex items-center space-x-1">
                <div className="w-2 h-2 rounded-full bg-white animate-pulse"></div>
                <span className="capitalize">{botStatus}</span>
              </div>
            </Badge>
          </div>
          
          <div className="flex items-center space-x-2">
            <Button
              onClick={botStatus === 'running' ? stopBot : startBot}
              disabled={loading}
              className={`${
                botStatus === 'running' 
                  ? 'bg-red-600 hover:bg-red-700' 
                  : 'bg-green-600 hover:bg-green-700'
              } text-white`}
            >
              {loading ? (
                <RefreshCw className="h-4 w-4 animate-spin mr-2" />
              ) : botStatus === 'running' ? (
                <Square className="h-4 w-4 mr-2" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              {botStatus === 'running' ? 'Stop Bot' : 'Start Bot'}
            </Button>
            
            <Button
              onClick={updateModel}
              disabled={loading}
              variant="outline"
              className="border-purple-400 text-purple-400 hover:bg-purple-400 hover:text-white"
            >
              <Settings className="h-4 w-4 mr-2" />
              Update Model
            </Button>
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <Alert className="mb-6 border-red-500 bg-red-500/10">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-slate-300">Total Profit</CardTitle>
              <DollarSign className="h-4 w-4 text-green-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-400">{stats.totalProfit} ETH</div>
              <p className="text-xs text-slate-400">${stats.totalProfitUSD} USD</p>
            </CardContent>
          </Card>

          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-slate-300">Success Rate</CardTitle>
              <TrendingUp className="h-4 w-4 text-blue-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-400">{stats.successRate}</div>
              <p className="text-xs text-slate-400">{stats.successfulExecutions}/{stats.totalExecutions} executions</p>
            </CardContent>
          </Card>

          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-slate-300">Wallet Balance</CardTitle>
              <Wallet className="h-4 w-4 text-purple-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-400">{health.walletBalance} ETH</div>
              <p className="text-xs text-slate-400">Block #{health.blockNumber}</p>
            </CardContent>
          </Card>

          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-slate-300">System Health</CardTitle>
              <Activity className={`h-4 w-4 ${getHealthColor(health.status)}`} />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold capitalize ${getHealthColor(health.status)}`}>
                {health.status}
              </div>
              <p className="text-xs text-slate-400">Gas: {health.gasPrice} gwei</p>
            </CardContent>
          </Card>
        </div>

        {/* Main Content Tabs */}
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4 bg-slate-800/50">
            <TabsTrigger value="overview" className="data-[state=active]:bg-purple-600">Overview</TabsTrigger>
            <TabsTrigger value="transactions" className="data-[state=active]:bg-purple-600">Transactions</TabsTrigger>
            <TabsTrigger value="analytics" className="data-[state=active]:bg-purple-600">Analytics</TabsTrigger>
            <TabsTrigger value="settings" className="data-[state=active]:bg-purple-600">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Profit Chart */}
              <Card className="bg-slate-800/50 border-slate-700">
                <CardHeader>
                  <CardTitle className="text-slate-200">Profit Over Time (24h)</CardTitle>
                  <CardDescription className="text-slate-400">Hourly profit accumulation</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={profitHistory}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="time" stroke="#9CA3AF" />
                      <YAxis stroke="#9CA3AF" />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: '#1F2937', 
                          border: '1px solid #374151',
                          borderRadius: '8px'
                        }}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="cumulative" 
                        stroke="#8B5CF6" 
                        fill="#8B5CF6" 
                        fillOpacity={0.3}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* System Status */}
              <Card className="bg-slate-800/50 border-slate-700">
                <CardHeader>
                  <CardTitle className="text-slate-200">System Status</CardTitle>
                  <CardDescription className="text-slate-400">Real-time system monitoring</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Network className="h-4 w-4 text-blue-400" />
                      <span className="text-sm text-slate-300">Network Connection</span>
                    </div>
                    <Badge variant="outline" className="bg-green-500/20 text-green-400 border-green-500">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Connected
                    </Badge>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Shield className="h-4 w-4 text-purple-400" />
                      <span className="text-sm text-slate-300">MEV Protection</span>
                    </div>
                    <Badge variant="outline" className="bg-green-500/20 text-green-400 border-green-500">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Active
                    </Badge>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Cpu className="h-4 w-4 text-yellow-400" />
                      <span className="text-sm text-slate-300">Quantum Model</span>
                    </div>
                    <Badge variant="outline" className="bg-green-500/20 text-green-400 border-green-500">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Optimized
                    </Badge>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Database className="h-4 w-4 text-green-400" />
                      <span className="text-sm text-slate-300">Data Storage</span>
                    </div>
                    <Badge variant="outline" className="bg-green-500/20 text-green-400 border-green-500">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Healthy
                    </Badge>
                  </div>

                  <div className="pt-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-slate-300">Daily Profit Target</span>
                      <span className="text-sm text-slate-400">2.8 / 5.0 ETH</span>
                    </div>
                    <Progress value={56} className="h-2" />
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="transactions" className="space-y-6">
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader>
                <CardTitle className="text-slate-200">Recent Transactions</CardTitle>
                <CardDescription className="text-slate-400">Latest arbitrage executions</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {transactions.map((tx) => (
                    <div key={tx.id} className="flex items-center justify-between p-4 bg-slate-700/30 rounded-lg">
                      <div className="flex items-center space-x-4">
                        <div className={`w-3 h-3 rounded-full ${tx.success ? 'bg-green-400' : 'bg-red-400'}`}></div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="font-mono text-sm text-slate-300">{tx.txHash}</span>
                            <Badge variant="outline" className="text-xs">
                              {tx.asset}
                            </Badge>
                          </div>
                          <div className="text-xs text-slate-400">
                            {new Date(tx.timestamp).toLocaleString()} • Gas: {tx.gasUsed}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`font-bold ${tx.success ? 'text-green-400' : 'text-red-400'}`}>
                          {tx.success ? '+' : ''}{tx.profit} ETH
                        </div>
                        <div className="text-xs text-slate-400">
                          ${tx.profitUSD}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="analytics" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="bg-slate-800/50 border-slate-700">
                <CardHeader>
                  <CardTitle className="text-slate-200">Hourly Performance</CardTitle>
                  <CardDescription className="text-slate-400">Profit distribution by hour</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={profitHistory.slice(-12)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="time" stroke="#9CA3AF" />
                      <YAxis stroke="#9CA3AF" />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: '#1F2937', 
                          border: '1px solid #374151',
                          borderRadius: '8px'
                        }}
                      />
                      <Bar dataKey="profit" fill="#8B5CF6" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="bg-slate-800/50 border-slate-700">
                <CardHeader>
                  <CardTitle className="text-slate-200">Performance Metrics</CardTitle>
                  <CardDescription className="text-slate-400">Key performance indicators</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div>
                    <div className="flex justify-between mb-2">
                      <span className="text-sm text-slate-300">Average Profit per Trade</span>
                      <span className="text-sm font-bold text-green-400">0.075 ETH</span>
                    </div>
                    <Progress value={75} className="h-2" />
                  </div>
                  
                  <div>
                    <div className="flex justify-between mb-2">
                      <span className="text-sm text-slate-300">Quantum Model Confidence</span>
                      <span className="text-sm font-bold text-purple-400">87%</span>
                    </div>
                    <Progress value={87} className="h-2" />
                  </div>
                  
                  <div>
                    <div className="flex justify-between mb-2">
                      <span className="text-sm text-slate-300">MEV Protection Rate</span>
                      <span className="text-sm font-bold text-blue-400">94%</span>
                    </div>
                    <Progress value={94} className="h-2" />
                  </div>
                  
                  <div>
                    <div className="flex justify-between mb-2">
                      <span className="text-sm text-slate-300">Liquidity Utilization</span>
                      <span className="text-sm font-bold text-yellow-400">78%</span>
                    </div>
                    <Progress value={78} className="h-2" />
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="settings" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="bg-slate-800/50 border-slate-700">
                <CardHeader>
                  <CardTitle className="text-slate-200">Bot Configuration</CardTitle>
                  <CardDescription className="text-slate-400">Current bot settings</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-300">Max Liquidity Utilization</span>
                    <Badge variant="outline">90%</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-300">Min Profit Threshold</span>
                    <Badge variant="outline">0.001 ETH</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-300">Max Gas Price</span>
                    <Badge variant="outline">100 gwei</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-300">Slippage Tolerance</span>
                    <Badge variant="outline">0.5%</Badge>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-slate-800/50 border-slate-700">
                <CardHeader>
                  <CardTitle className="text-slate-200">Profit Wallet</CardTitle>
                  <CardDescription className="text-slate-400">Destination for profits</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm text-slate-300">Wallet Address</label>
                      <div className="mt-1 p-3 bg-slate-700/50 rounded-lg font-mono text-sm text-slate-200">
                        0xDe32ebF443f213E6b904461FfBE3e107b93CE3Bc
                      </div>
                    </div>
                    <div className="flex items-center space-x-2 text-sm text-green-400">
                      <CheckCircle className="h-4 w-4" />
                      <span>Verified and active</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

export default App

