import {
  json,
  serve,
  validateRequest,
} from "https://deno.land/x/sift@0.4.0/mod.ts";

import {
  Rcon,
  BadIpException,
  BadRconPasswordException,
  RconConnectionClosedException,
} from "./rcon.ts";

import { RconRequestDto } from "./types.ts";

const getHeaders = () => {
  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "POST");
  headers.set("Access-Control-Allow-Headers", "Content-Type");

  return headers;
};

serve({
  "/": home,
  404: notFound,
});

function notFound() {
  return new Response(
    JSON.stringify({
      statusCode: 404,
      message: "Not found",
      error: "Not Found",
    }),
    { status: 404 }
  );
}

async function home(req: Request) {
  if (req.method.toUpperCase() === "OPTIONS") {
    return new Response("OK", { status: 200, headers: getHeaders() });
  }

  let body: RconRequestDto;
  try {
    body = await validateBody(req);
  } catch (err) {
    if (err instanceof Response) {
      return err;
    }

    throw err;
  }

  try {
    const rcon = new Rcon(body.ip, body.port ?? 27015, body.password);

    const response = await rcon.sendCmd(body.command);

    return json(
      {
        statusCode: 200,
        response,
      },
      {
        headers: getHeaders(),
      }
    );
  } catch (err) {
    if (err instanceof BadIpException) {
      return json(
        {
          statusCode: 400,
          message: err.message,
          error: "Bad Request",
        },
        {
          headers: getHeaders(),
        }
      );
    } else if (err instanceof BadRconPasswordException) {
      return json(
        {
          statusCode: 400,
          message: err.message,
          error: "Bad Request",
        },
        {
          headers: getHeaders(),
        }
      );
    } else if (err instanceof RconConnectionClosedException) {
      return json(
        {
          statusCode: 400,
          message: err.message,
          error: "Bad Request",
        },
        {
          headers: getHeaders(),
        }
      );
    }

    console.error(err);

    return json(
      {
        statusCode: 500,
        message: "Unexpected error occured",
        error: "Internal Server Error",
      },
      {
        headers: getHeaders(),
      }
    );
  }
}

async function validateBody(req: Request) {
  try {
    const { error, body } = await validateRequest(req, {
      POST: {
        body: ["ip", "password", "command"],
      },
    });

    if (error) {
      throw json({ error: error.message }, { status: error.status });
    }

    return body as unknown as RconRequestDto;
  } catch (_err) {
    throw json({
      statusCode: 400,
      message: "Body must be present",
      error: "Bad Request",
    });
  }
}
