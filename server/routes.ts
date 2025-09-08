import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { BinanceService } from "./services/binanceService";
import { TelegramService } from "./services/telegramService";
import { IndicatorService } from "./services/indicatorService";
import { insertUserSettingsSchema, insertIndicatorConfigSchema, insertPositionSchema } from "@shared/schema";
import { z } from "zod";

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);
  
  // Initialize services
  const binanceService = new BinanceService();
  const telegramService = new TelegramService();
  const indicatorService = new IndicatorService();

  // WebSocket server for real-time data
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const clients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log('WebSocket client connected');

    ws.on('close', () => {
      clients.delete(ws);
      console.log('WebSocket client disconnected');
    });

    // Send initial data
    ws.send(JSON.stringify({
      type: 'connection',
      status: 'connected'
    }));
  });

  // Broadcast to all connected clients
  const broadcast = (data: any) => {
    const message = JSON.stringify(data);
    clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  };

  // Initialize trading pairs
  await binanceService.initializeTradingPairs();

  // Start real-time data streams
  binanceService.startPriceStreams((data) => {
    broadcast({
      type: 'price_update',
      data
    });
  });

  // API Routes

  // Get trading pairs
  app.get('/api/pairs', async (req, res) => {
    try {
      const pairs = await storage.getAllTradingPairs();
      res.json(pairs);
    } catch (error) {
      console.error('Error fetching pairs:', error);
      res.status(500).json({ message: 'Failed to fetch trading pairs' });
    }
  });

  // Get market data
  app.get('/api/market-data', async (req, res) => {
    try {
      const symbols = req.query.symbols ? 
        (req.query.symbols as string).split(',') : undefined;
      const data = await storage.getMarketData(symbols);
      res.json(data);
    } catch (error) {
      console.error('Error fetching market data:', error);
      res.status(500).json({ message: 'Failed to fetch market data' });
    }
  });

  // User settings routes
  app.get('/api/settings/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      const settings = await storage.getUserSettings(userId);
      res.json(settings);
    } catch (error) {
      console.error('Error fetching settings:', error);
      res.status(500).json({ message: 'Failed to fetch settings' });
    }
  });

  app.post('/api/settings', async (req, res) => {
    try {
      const settings = insertUserSettingsSchema.parse(req.body);
      const result = await storage.upsertUserSettings(settings);
      
      // Update services with new settings
      if (settings.binanceApiKey && settings.binanceApiSecret) {
        binanceService.updateCredentials(settings.binanceApiKey, settings.binanceApiSecret, settings.isTestnet ?? false);
      }
      if (settings.telegramBotToken && settings.telegramChatId) {
        telegramService.updateCredentials(settings.telegramBotToken, settings.telegramChatId);
      }
      
      res.json(result);
    } catch (error) {
      console.error('Error saving settings:', error);
      res.status(500).json({ message: 'Failed to save settings' });
    }
  });

  // Position routes
  app.get('/api/positions/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      const positions = await storage.getUserPositions(userId);
      res.json(positions);
    } catch (error) {
      console.error('Error fetching positions:', error);
      res.status(500).json({ message: 'Failed to fetch positions' });
    }
  });

  app.post('/api/positions', async (req, res) => {
    try {
      const position = insertPositionSchema.parse(req.body);
      
      // Execute trade through Binance
      const order = await binanceService.createOrder(
        position.symbol,
        position.side as 'LONG' | 'SHORT',
        parseFloat(position.size),
        position.stopLoss ? parseFloat(position.stopLoss) : undefined,
        position.takeProfit ? parseFloat(position.takeProfit) : undefined
      );

      if (order) {
        position.orderId = order.orderId;
        const result = await storage.createPosition(position);
        
        // Send notification
        await telegramService.sendTradeNotification({
          action: 'opened',
          symbol: position.symbol,
          side: position.side,
          size: position.size,
          price: position.entryPrice,
          stopLoss: position.stopLoss ?? undefined,
          takeProfit: position.takeProfit ?? undefined
        });

        broadcast({
          type: 'position_opened',
          data: result
        });

        res.json(result);
      } else {
        res.status(400).json({ message: 'Failed to execute trade' });
      }
    } catch (error) {
      console.error('Error creating position:', error);
      res.status(500).json({ message: 'Failed to create position' });
    }
  });

  app.put('/api/positions/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      const result = await storage.updatePosition(id, updates);
      
      broadcast({
        type: 'position_updated',
        data: result
      });
      
      res.json(result);
    } catch (error) {
      console.error('Error updating position:', error);
      res.status(500).json({ message: 'Failed to update position' });
    }
  });

  app.delete('/api/positions/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const position = await storage.closePosition(id);
      
      // Cancel order on Binance if needed
      if (position.orderId) {
        await binanceService.cancelOrder(position.symbol, position.orderId);
      }

      broadcast({
        type: 'position_closed',
        data: position
      });
      
      res.json(position);
    } catch (error) {
      console.error('Error closing position:', error);
      res.status(500).json({ message: 'Failed to close position' });
    }
  });

  app.post('/api/positions/:userId/close-all', async (req, res) => {
    try {
      const { userId } = req.params;
      const positions = await storage.getUserPositions(userId);
      
      // Cancel all orders on Binance
      for (const position of positions) {
        if (position.orderId) {
          await binanceService.cancelOrder(position.symbol, position.orderId);
        }
      }
      
      await storage.closeAllUserPositions(userId);
      
      await telegramService.sendNotification('🛑 All positions have been closed');
      
      broadcast({
        type: 'all_positions_closed',
        userId
      });
      
      res.json({ message: 'All positions closed' });
    } catch (error) {
      console.error('Error closing all positions:', error);
      res.status(500).json({ message: 'Failed to close all positions' });
    }
  });

  // Indicator routes
  app.get('/api/indicators/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      const indicators = await storage.getUserIndicators(userId);
      res.json(indicators);
    } catch (error) {
      console.error('Error fetching indicators:', error);
      res.status(500).json({ message: 'Failed to fetch indicators' });
    }
  });

  app.post('/api/indicators', async (req, res) => {
    try {
      const indicator = insertIndicatorConfigSchema.parse(req.body);
      const result = await storage.createIndicatorConfig(indicator);
      res.json(result);
    } catch (error) {
      console.error('Error creating indicator:', error);
      res.status(500).json({ message: 'Failed to create indicator' });
    }
  });

  app.put('/api/indicators/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      const result = await storage.updateIndicatorConfig(id, updates);
      res.json(result);
    } catch (error) {
      console.error('Error updating indicator:', error);
      res.status(500).json({ message: 'Failed to update indicator' });
    }
  });

  app.delete('/api/indicators/:id', async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteIndicatorConfig(id);
      res.json({ message: 'Indicator deleted' });
    } catch (error) {
      console.error('Error deleting indicator:', error);
      res.status(500).json({ message: 'Failed to delete indicator' });
    }
  });

  // Signal routes
  app.get('/api/signals', async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const signals = await storage.getRecentSignals(limit);
      res.json(signals);
    } catch (error) {
      console.error('Error fetching signals:', error);
      res.status(500).json({ message: 'Failed to fetch signals' });
    }
  });

  app.get('/api/signals/:symbol', async (req, res) => {
    try {
      const { symbol } = req.params;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
      const signals = await storage.getSignalsBySymbol(symbol, limit);
      res.json(signals);
    } catch (error) {
      console.error('Error fetching signals:', error);
      res.status(500).json({ message: 'Failed to fetch signals' });
    }
  });

  // Pair timeframes routes
  app.get('/api/pair-timeframes/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      const timeframes = await storage.getUserPairTimeframes(userId);
      res.json(timeframes);
    } catch (error) {
      console.error('Error fetching pair timeframes:', error);
      res.status(500).json({ message: 'Failed to fetch pair timeframes' });
    }
  });

  app.post('/api/pair-timeframes', async (req, res) => {
    try {
      const timeframes = req.body;
      const result = await storage.upsertPairTimeframes(timeframes);
      res.json(result);
    } catch (error) {
      console.error('Error saving pair timeframes:', error);
      res.status(500).json({ message: 'Failed to save pair timeframes' });
    }
  });

  // Telegram test route
  app.post('/api/telegram/test', async (req, res) => {
    try {
      const { botToken, chatId } = req.body;
      const success = await telegramService.testConnection(botToken, chatId);
      res.json({ success });
    } catch (error) {
      console.error('Error testing telegram:', error);
      res.status(500).json({ message: 'Failed to test telegram connection' });
    }
  });

  return httpServer;
}
