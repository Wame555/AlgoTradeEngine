# Crypto Trading Bot

## Overview

This is a full-stack cryptocurrency trading application built with React frontend and Express backend. The system provides automated trading capabilities with technical indicator analysis, real-time market data processing, and Telegram notifications. It features a modern dark-themed UI for managing trading positions, analyzing market signals, and configuring trading parameters. The application supports multiple cryptocurrency pairs and includes comprehensive risk management tools.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **React SPA**: Single-page application using React 18 with TypeScript
- **Component Library**: shadcn/ui components with Radix UI primitives for consistent design system
- **Styling**: Tailwind CSS with custom CSS variables for theming support
- **State Management**: TanStack React Query for server state management and caching
- **Routing**: Wouter for lightweight client-side routing
- **Form Handling**: React Hook Form with Zod validation schemas
- **Real-time Updates**: WebSocket connection for live price feeds and position updates

### Backend Architecture
- **Express Server**: Node.js REST API with Express framework
- **WebSocket Server**: Real-time bidirectional communication using ws library
- **Database ORM**: Drizzle ORM with PostgreSQL for type-safe database operations
- **Service Layer**: Modular services for Binance integration, Telegram notifications, and technical indicators
- **API Design**: RESTful endpoints with consistent error handling and logging middleware

### Database Design
- **PostgreSQL**: Primary database with Neon serverless hosting
- **Schema Management**: Drizzle migrations with shared schema definitions
- **Core Entities**: Users, trading pairs, positions, signals, indicator configurations, and market data
- **Data Relationships**: Foreign key relationships between users and their trading data

### Trading System
- **Market Data**: Real-time price feeds from Binance API with WebSocket streams
- **Technical Indicators**: RSI, MACD, Moving Averages with configurable parameters
- **Signal Generation**: Combined indicator analysis with confidence scoring
- **Position Management**: Automated entry/exit with stop-loss and take-profit orders
- **Risk Management**: Configurable risk percentage and leverage limits

### Authentication & Security
- **Session Management**: Express sessions with PostgreSQL session store
- **API Security**: Input validation using Zod schemas
- **Environment Configuration**: Secure credential management for API keys

## External Dependencies

### Trading & Market Data
- **Binance API**: Cryptocurrency market data, order execution, and account management
- **WebSocket Streams**: Real-time price feeds and order book updates

### Database & Infrastructure
- **Neon Database**: Serverless PostgreSQL hosting with connection pooling
- **Drizzle ORM**: Type-safe database queries and migrations

### Notifications
- **Telegram Bot API**: Trade notifications and alerts via Telegram messaging

### Development Tools
- **Vite**: Fast build tool and development server with HMR
- **TypeScript**: Type safety across frontend and backend
- **ESBuild**: Production bundling for server-side code

### UI & Styling
- **Radix UI**: Accessible component primitives
- **Tailwind CSS**: Utility-first CSS framework
- **Lucide Icons**: Consistent icon library
- **Date-fns**: Date formatting and manipulation

### Monitoring & Development
- **Replit Integration**: Development environment with runtime error overlay
- **WebSocket Health Monitoring**: Connection status tracking and auto-reconnection