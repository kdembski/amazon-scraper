export class WebSocketService<MessageT> {
  private ws?: WebSocket;
  private url: string;
  onmessage?: (e: MessageEvent<string>) => void;

  constructor(path: string) {
    this.url = process.env.API_URL?.replace("http", "ws") + "/" + path;
  }

  private isOpen = () => this.ws?.readyState === WebSocket.OPEN;

  private isClosed = () =>
    this.ws?.readyState === WebSocket.CLOSED ||
    this.ws?.readyState === WebSocket.CLOSING;

  private isConnecting = () => this.ws?.readyState === WebSocket.CONNECTING;

  init = () => {
    if (this.isOpen()) {
      return;
    }

    this.ws = new WebSocket(this.url);

    if (!this.ws || !this.onmessage) return;
    this.ws.onmessage = this.onmessage;
  };

  send = async (message: MessageT) => {
    if (!this.ws || this.isClosed()) {
      setTimeout(() => {
        this.init();
        this.send(message);
      }, 5);

      return;
    }

    if (this.isConnecting()) {
      setTimeout(() => {
        this.send(message);
      }, 5);

      return;
    }

    this.ws.send(JSON.stringify(message));
  };
}
