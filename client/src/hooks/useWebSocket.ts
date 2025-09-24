import { useEffect, useState, useRef } from 'react';
import { WebSocketMessage, PriceUpdate } from '@/types/trading';

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [priceData, setPriceData] = useState<Map<string, PriceUpdate>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      
      try {
        wsRef.current = new WebSocket(wsUrl);

        wsRef.current.onopen = () => {
          console.log('WebSocket connected');
          setIsConnected(true);
        };

        wsRef.current.onmessage = (event) => {
          try {
            const message: WebSocketMessage = JSON.parse(event.data);
            
            switch (message.type) {
              case 'connection':
                console.log('WebSocket connection confirmed');
                break;
              
              case 'price_update':
                if (message.data) {
                  setPriceData(prev => {
                    const newData = new Map(prev);
                    newData.set(message.data.symbol, message.data);
                    return newData;
                  });
                }
                break;
              
              case 'position_opened':
              case 'position_updated':
              case 'position_closed':
              case 'all_positions_closed':
                // Emit custom events that components can listen to
                window.dispatchEvent(new CustomEvent(message.type, { detail: message.data }));
                break;
              
              default:
                console.log('Unknown WebSocket message type:', message.type);
            }
          } catch (error) {
            console.error('Error parsing WebSocket message:', error);
          }
        };

        wsRef.current.onclose = (event) => {
          console.log('WebSocket disconnected:', event.reason);
          setIsConnected(false);
          
          // Attempt to reconnect after 3 seconds
          setTimeout(connect, 3000);
        };

        wsRef.current.onerror = (error) => {
          console.error('WebSocket error:', error);
          setIsConnected(false);
        };
      } catch (error) {
        console.error('Error creating WebSocket connection:', error);
        setTimeout(connect, 3000);
      }
    };

    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const sendMessage = (message: WebSocketMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket is not connected');
    }
  };

  return {
    isConnected,
    priceData,
    sendMessage,
  };
}
