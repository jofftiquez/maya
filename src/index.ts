import express, { Request, RequestHandler, Response, Express, NextFunction } from "express";
import { DatabaseModule, IRoutes, IRoutesOptions, IRoute, AppModule } from "./interfaces";
import * as bodyparser from "body-parser";
import morgan from "morgan";
import cors from "cors";
import http from "http";
import { addDatabase } from "./utils/Database";
import { Injector } from "./utils/Injector";
import { Callback } from "./types";

export * from "./interfaces";
export * from "./utils/App";
export * from "./utils/Methods";
export { Controller } from "./utils/Controller";
export { Injectable } from "./utils/Injectable";
export { Database } from "./utils/Database";
export { Request, Response, NextFunction };

export class MayaJS {
  private app: Express;
  private isProd = false;
  private hasLogs = false;
  private databases: DatabaseModule[] = [];
  private routes: IRoutesOptions[] = [];
  private cors!: RequestHandler;
  private logger!: RequestHandler;
  private bodyParser: { json?: RequestHandler; urlencoded?: RequestHandler } = {};

  constructor(appModule: AppModule) {
    this.setDefaultPluginsSettings();
    this.app = express();
    this.databases = appModule?.databases ?? [];
    this.routes = appModule?.routes ?? [];
  }

  /**
   * Enable production mode
   * @param boolean bool - Turn on prod mode
   */
  prodMode(bool: boolean): this {
    this.isProd = bool ? true : this.isProd;
    return this;
  }

  /**
   * Run the server using the port specified or the default port : 3333
   * @param port number - Specify port number that the server will listen too.
   * @returns An instance of http.Server
   */
  start(port: number = 3333): http.Server {
    const server = http.createServer(this.app);

    try {
      server.listen(port, this.onListen(port));
    } catch (error) {
      server.close();
      throw new Error(error);
    }

    process
      .on("unhandledRejection", (reason, promise) => {
        console.log(reason, "Unhandled Rejection", promise);
      })
      .on("uncaughtException", err => {
        console.log(err, "Uncaught Exception thrown");
      });

    return server;
  }

  /**
   * Adds array of middleware functions before initialization routes
   * @param plugins RequestHandler[] - Callback function from a middleware
   */
  plugins(plugins: RequestHandler[]): this {
    for (const plugin of plugins) {
      this.app.use(plugin);
    }
    return this;
  }

  /**
   * Adds middleware function before initialization of routes
   * @param middleware RequestHandler - Callback function from a middleware
   */
  use(middleware: RequestHandler): this {
    this.app.use(middleware);
    return this;
  }

  /**
   * Set default body parser
   * @param bodyParser A set of middleware functions that parses an incoming request body
   */
  setBodyParser(bodyParser: { json?: RequestHandler; urlencoded?: RequestHandler }): this {
    if (Object.keys(bodyParser).length > 0) {
      this.bodyParser = bodyParser;
    }
    return this;
  }

  /**
   * Set default CORS options
   * @param cors A middleware function that sets the cors settings of a request
   */
  setCORS(cors: RequestHandler): this {
    this.cors = cors;
    return this;
  }

  /**
   * Set default logger
   * @param logger A middleware function that logs request
   */
  setLogger(logger: RequestHandler): this {
    this.logger = logger;
    return this;
  }

  /**
   * Sets the routes to be injected as a middleware
   *
   * @param routes IRoutesOptions[] - A list of routes options for each routes
   */
  private setRoutes(routes: IRoutesOptions[]): void {
    routes.map((route: IRoutesOptions) => {
      const { path, middlewares, router } = this.configRoutes(route);
      this.app.use(path, middlewares, router);
    });
  }

  /**
   * Sets the default plugins settings for MayaJS
   */
  private setDefaultPluginsSettings() {
    this.bodyParser["json"] = bodyparser.json({ limit: "50mb" });
    this.bodyParser["urlencoded"] = bodyparser.urlencoded({ extended: true, limit: "50mb", parameterLimit: 100000000 });
    this.cors = cors();
  }

  /**
   * Sets the default plugins for MayaJS
   */
  private setDefaultPlugins() {
    this.app.use(this.cors);
    this.app.use(this.bodyParser.json as RequestHandler);
    this.app.use(this.bodyParser.urlencoded as RequestHandler);
    this.app.use(this.logger ? this.logger : morgan(this.isProd ? "tiny" : "dev"));
  }

  private unhandleErrors(app: Express): void {
    app.use((req: Request, res: Response) => {
      if (!req.route) {
        const url = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
        return res.status(405).json({ status: "Invalid Request", message: `Request: (${req.method}) ${url} is invalid!` });
      }
    });
  }

  private onListen(port: any): () => void {
    return () => {
      if (this.hasLogs) {
        console.log(`\x1b[32m[mayajs] Server running on port ${port}\x1b[0m`);
      }

      this.setDefaultPlugins();
      this.connectDatabase(this.databases)
        .then(() => {
          this.setRoutes(this.routes);
          this.unhandleErrors(this.app);
        })
        .catch(error => {
          console.log(`\n\x1b[31m${error}\x1b[0m`);
        });
    };
  }

  private connectDatabase(databases: DatabaseModule[]): Promise<void[]> {
    if (databases.length > 0) {
      return Promise.all(
        databases.map(async (db: DatabaseModule) => {
          db.connection(this.hasLogs);
          return await db.connect().then(() => {
            const models = db.models();
            addDatabase(db, models);
          });
        })
      );
    }

    return Promise.resolve([]);
  }

  private configRoutes(args: IRoutesOptions): IRoutes {
    const { middlewares = [], callback = (error: any, req: Request, res: Response, next: NextFunction): void => next() } = args;
    const router = express.Router();

    args.controllers.map((controller: any) => {
      const instance = Injector.resolve<typeof controller>(controller);
      const prefix: string = Reflect.getMetadata("prefix", controller);
      const routes: IRoute[] = Reflect.getMetadata("routes", controller);
      const method = (name: string): Callback => (req: Request, res: Response, next: NextFunction): void => instance[name](req, res, next);
      routes.map((route: IRoute) => router[route.requestMethod](prefix + route.path, route.middlewares, method(route.methodName), callback));
    });
    return { path: args.path || "", middlewares, router };
  }
}
