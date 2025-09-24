export interface TradeNotification {
  action: 'opened' | 'closed' | 'updated';
  symbol: string;
  side: string;
  size: string;
  price: string;
  pnl?: string;
  stopLoss?: string;
  takeProfit?: string;
}

export class TelegramService {
  private botToken: string = '';
  private chatId: string = '';

  constructor() {
    // Initialize with environment variables if available
    this.botToken = process.env.TELEGRAM_BOT_TOKEN || '';
    this.chatId = process.env.TELEGRAM_CHAT_ID || '';
  }

  updateCredentials(botToken: string, chatId: string) {
    this.botToken = botToken;
    this.chatId = chatId;
  }

  async testConnection(botToken?: string, chatId?: string): Promise<boolean> {
    try {
      const token = botToken || this.botToken;
      const chat = chatId || this.chatId;
      
      if (!token || !chat) {
        return false;
      }

      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chat,
          text: '🤖 Crypto Bot connection test successful!',
          parse_mode: 'HTML',
        }),
      });

      const data = await response.json();
      return data.ok === true;
    } catch (error) {
      console.error('Telegram test error:', error);
      return false;
    }
  }

  async sendNotification(message: string): Promise<boolean> {
    try {
      if (!this.botToken || !this.chatId) {
        console.error('Telegram credentials not configured');
        return false;
      }

      const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: this.chatId,
          text: message,
          parse_mode: 'HTML',
        }),
      });

      const data = await response.json();
      return data.ok === true;
    } catch (error) {
      console.error('Telegram notification error:', error);
      return false;
    }
  }

  async sendTradeNotification(trade: TradeNotification): Promise<boolean> {
    try {
      const emoji = trade.action === 'opened' ? '📈' : 
                   trade.action === 'closed' ? '📉' : '📊';
      const actionText = trade.action.toUpperCase();
      const sideEmoji = trade.side === 'LONG' ? '🟢' : '🔴';
      
      let message = `${emoji} <b>Position ${actionText}</b>\n\n`;
      message += `${sideEmoji} <b>${trade.symbol}</b> - ${trade.side}\n`;
      message += `💰 Size: ${trade.size}\n`;
      message += `💵 Price: $${trade.price}\n`;
      
      if (trade.pnl) {
        const pnlEmoji = parseFloat(trade.pnl) >= 0 ? '💚' : '❤️';
        message += `${pnlEmoji} P&L: $${trade.pnl}\n`;
      }
      
      if (trade.stopLoss) {
        message += `🛡️ Stop Loss: $${trade.stopLoss}\n`;
      }
      
      if (trade.takeProfit) {
        message += `🎯 Take Profit: $${trade.takeProfit}\n`;
      }
      
      message += `\n⏰ ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC`;

      return await this.sendNotification(message);
    } catch (error) {
      console.error('Trade notification error:', error);
      return false;
    }
  }

  async sendSignalNotification(symbol: string, signal: string, confidence: number, price: string): Promise<boolean> {
    try {
      const emoji = signal === 'LONG' ? '📈' : signal === 'SHORT' ? '📉' : '⏸️';
      const signalEmoji = signal === 'LONG' ? '🟢' : signal === 'SHORT' ? '🔴' : '🟡';
      
      let message = `${emoji} <b>Trading Signal</b>\n\n`;
      message += `${signalEmoji} <b>${symbol}</b>\n`;
      message += `📊 Signal: <b>${signal}</b>\n`;
      message += `🎯 Confidence: <b>${confidence}%</b>\n`;
      message += `💵 Price: $${price}\n`;
      message += `\n⏰ ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC`;

      return await this.sendNotification(message);
    } catch (error) {
      console.error('Signal notification error:', error);
      return false;
    }
  }

  async sendBalanceUpdate(balance: string, dailyPnL: string): Promise<boolean> {
    try {
      const pnlEmoji = parseFloat(dailyPnL) >= 0 ? '💚' : '❤️';
      const pnlPrefix = parseFloat(dailyPnL) >= 0 ? '+' : '';
      
      let message = `💼 <b>Balance Update</b>\n\n`;
      message += `💰 Total Balance: $${balance}\n`;
      message += `${pnlEmoji} 24h P&L: ${pnlPrefix}$${dailyPnL}\n`;
      message += `\n⏰ ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC`;

      return await this.sendNotification(message);
    } catch (error) {
      console.error('Balance notification error:', error);
      return false;
    }
  }
}
