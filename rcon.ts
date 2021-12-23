import { concat, equals } from "https://deno.land/std@0.92.0/bytes/mod.ts";
import { iterateReader } from "https://deno.land/std@0.117.0/streams/conversion.ts";

const FrameBuffer = new Uint8Array([0, 1, 0, 0]);

const PacketType = {
  COMMAND: 0x02,
  AUTH: 0x03,
  RESPONSE_VALUE: 0x00,
  RESPONSE_AUTH: 0x02,
};

export class BadIpException extends Error {
  constructor() {
    super();
    this.message = "Failed to resolve IP";
  }
}

export class BadRconPasswordException extends Error {
  constructor() {
    super();
    this.message = "Provided RCON password is incorrect";
  }
}

export class RconConnectionClosedException extends Error {
  constructor() {
    super();
    this.message = "RCON server connection closed unexpectedly";
  }
}

class Request {
  public data = new Uint8Array();

  constructor(
    public readonly resolve: (value: string) => void,
    public readonly reject: (error: unknown) => void
  ) {}
}

class ResolvablePromise {
  resolve!: () => void;

  reject!: (error: unknown) => void;

  promise = new Promise<void>((res, rej) => {
    this.resolve = res;
    this.reject = rej;
  });
}

export class Rcon {
  private authed?: ResolvablePromise;

  private conn?: Deno.Conn;

  private outstandingData?: Uint8Array;

  private requests = new Map<number, Request>();

  constructor(
    private host = "localhost",
    private port = 27015,
    private password = ""
  ) {}

  sendCmd(cmd: string) {
    return this.send(cmd, PacketType.COMMAND);
  }

  private async connect() {
    if (this.conn) {
      return this.authed?.promise;
    }

    try {
      this.authed = new ResolvablePromise();

      this.conn = await Deno.connect({
        hostname: this.host,
        port: this.port,
      });

      // Don't await.
      void this.read().catch();

      await this.sendData(
        new Uint8Array([0, 0, 0, 0]),
        this.password,
        PacketType.AUTH
      );
    } catch (err) {
      if (
        err instanceof Deno.errors.ConnectionRefused ||
        err instanceof Deno.errors.ConnectionReset
      ) {
        throw new BadIpException();
      }

      console.warn(err);

      throw err;
    }
  }

  private async read() {
    const conn = this.conn!;
    try {
      for await (const chunk of iterateReader(conn)) {
        this.readChunk(chunk);
      }
    } finally {
      if (this.conn === conn) {
        this.conn = undefined;
        this.authed?.reject(new RconConnectionClosedException());
        this.authed = undefined;
        this.requests.forEach((request) =>
          request.reject(new RconConnectionClosedException())
        );
        this.requests.clear();
      }
    }
  }

  disconnect() {
    this.conn?.close();
    this.conn = undefined;
    this.authed = undefined;
    this.requests.forEach((request) => request.reject(new Error("read EOF")));
    this.requests.clear();
  }

  private readChunk(data: Uint8Array) {
    if (this.outstandingData) {
      data = concat(this.outstandingData, data);
      this.outstandingData = undefined;
    }

    while (data.length) {
      const dataView = new DataView(data.buffer);
      const len = dataView.getInt32(0, true);
      if (!len) return;

      if (len >= 10 && data.length >= len + 4) {
        const id = dataView.getInt32(4, true);
        const type = dataView.getInt32(8, true);
        const payload = data.slice(12, 12 + len - 10);
        if (id !== -1) {
          if (type === PacketType.RESPONSE_AUTH && id === 0) {
            this.authed?.resolve();
          } else if (type === PacketType.RESPONSE_VALUE) {
            // Read just the body of the packet (truncate the last null byte)
            // See https://developer.valvesoftware.com/wiki/Source_RCON_Protocol for details

            const request = this.requests.get(id);
            if (request) {
              if (equals(FrameBuffer, payload)) {
                const str = new TextDecoder().decode(request.data);
                request.resolve(str);
                this.requests.delete(id);
              } else {
                request.data = concat(request.data, payload);
              }
            }
          }
        } else if (id == -1) {
          this.authed?.reject(new BadRconPasswordException());
        }

        data = data.slice(4 + len);
      } else {
        // Keep the data of the chunk if it doesn't represent a full packet
        this.outstandingData = new Uint8Array(data.length);
        this.outstandingData.set(data, 0);
        break;
      }
    }
  }

  private async send(data: string, packetType: number) {
    await this.connect();
    const id = crypto.getRandomValues(new Uint8Array(4));
    const idNumber = new DataView(id.buffer).getInt32(0, true);
    const sendPromise = new Promise<string>((resolve, reject) => {
      this.requests.set(idNumber, new Request(resolve, reject));
    });
    try {
      await this.sendData(id, data, packetType);
      await this.sendData(id, "", PacketType.RESPONSE_VALUE);
    } catch (e) {
      this.requests.get(idNumber)?.reject(e);
    }
    return sendPromise;
  }

  private async sendData(id: Uint8Array, data: string, packetType: number) {
    const dataBuffer = new TextEncoder().encode(data);
    const dataLength = dataBuffer.length;

    const sendBuffer = new Uint8Array(dataLength + 14);
    const view = new DataView(sendBuffer.buffer);
    view.setInt32(0, dataLength + 10, true);
    sendBuffer.set(id, 4);
    view.setInt32(8, packetType, true);
    sendBuffer.set(dataBuffer, 12);
    view.setInt16(dataLength + 12, 0, true);

    await this.conn?.write(sendBuffer);
  }
}
