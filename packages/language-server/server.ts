import ConfigRO from '@sqltools/util/config-manager';
import { createConnection, IConnection, InitializedParams, InitializeResult, ProposedFeatures, TextDocuments, TextDocumentSyncKind } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { InvalidActionError } from '@sqltools/util/exception';
import log from '@sqltools/util/log';
import telemetry from '@sqltools/util/telemetry';
import { ILanguageServer, ILanguageServerPlugin, Arg0 } from '@sqltools/types';
import { DISPLAY_NAME, EXT_CONFIG_NAMESPACE } from '@sqltools/util/constants';

class SQLToolsLanguageServer implements ILanguageServer {
  private _server: IConnection;
  private _docManager = new TextDocuments(TextDocument);
  private onInitializeHooks: Arg0<IConnection['onInitialize']>[] = [];
  private onInitializedHooks: Arg0<IConnection['onInitialized']>[] = [];
  private onDidChangeConfigurationHooks: Function[] = [];

  constructor() {
    this._server = createConnection(ProposedFeatures.all);
    this._server.onInitialized(this.onInitialized);
    this._server.onInitialize(this.onInitialize);
    this._server.onDidChangeConfiguration(this.onDidChangeConfiguration);
    this._docManager.listen(this._server);
  }

  private onInitialized: Arg0<IConnection['onInitialized']> = (params: InitializedParams) => {
    telemetry.registerMessage('info', `Initialized with node version:${process.version}`);

    this.onInitializedHooks.forEach(hook => hook(params));
  };

  private onInitialize: Arg0<IConnection['onInitialize']> = (params, token, workDoneProgress, resultProgress) => {
    if (params.initializationOptions.telemetry) {
      telemetry.updateOpts({
        ...params.initializationOptions.telemetry,
      });
    }
    if (params.initializationOptions.userEnvVars && Object.keys(params.initializationOptions.userEnvVars || {}).length > 0) {
      log.extend('debug')(`User defined env vars ===============================\n%O\n===============================:`, params.initializationOptions.userEnvVars);
    }

    return this.onInitializeHooks.reduce<InitializeResult>(
      (opts, hook) => {
        const result = hook(params, token, workDoneProgress, resultProgress) as InitializeResult;
        return { ...result, capabilities: { ...opts.capabilities, ...result.capabilities } };
      },
      {
        capabilities: {
          documentFormattingProvider: true,
          documentRangeFormattingProvider: true,
          textDocumentSync: TextDocumentSyncKind.Incremental,
        },
      }
    );
  };

  private onDidChangeConfiguration: Arg0<IConnection['onDidChangeConfiguration']> = changes => {
    ConfigRO.replaceAll(changes.settings[EXT_CONFIG_NAMESPACE]);
    if (changes.settings.telemetry && changes.settings.telemetry.enableTelemetry) telemetry.enable();
    else telemetry.disable();

    this.onDidChangeConfigurationHooks.forEach(hook => hook());
  };
  public get onDocumentFormatting() {
    return this._server.onDocumentFormatting;
  }
  public get onDocumentRangeFormatting() {
    return this._server.onDocumentRangeFormatting;
  }

  public get onCompletion() {
    return this._server.onCompletion;
  }

  public get onCompletionResolve() {
    return this._server.onCompletionResolve;
  }

  public listen() {
    log.extend('info')(`${DISPLAY_NAME} Server started!
===============================
Using node runtime?: ${parseInt(process.env.IS_NODE_RUNTIME || '0') === 1}
ExecPath: ${process.execPath}
===============================`)
    this._server.listen();
    return this;
  }

  public registerPlugin(plugin: ILanguageServerPlugin) {
    plugin.register(this);
    return this;
  }

  public get sendNotification(): IConnection['sendNotification'] {
    return this._server.sendNotification;
  }
  public get onNotification(): IConnection['onNotification'] {
    return this._server.onNotification;
  }
  public onRequest: IConnection['onRequest'] = (req, handler?: any) => {
    if (!handler) throw new InvalidActionError('Disabled registration for * handlers');
    return this._server.onRequest(req, async (...args) => {
      log.extend('debug')('REQUEST => %s', req._method || req.toString());
      process.env.NODE_ENV === 'development' && log.extend('debug')('REQUEST => %s %O', req._method || req.toString(), args);
      process.env.NODE_ENV !== 'development' && log.extend('debug')('REQUEST => %s', req._method || req.toString());
      return Promise.resolve(handler(...args));
    });
  }

  public get sendRequest(): IConnection['sendRequest'] {
    return this._server.sendRequest;
  }

  public addOnDidChangeConfigurationHooks(hook: Arg0<IConnection['onDidChangeConfiguration']>) {
    this.onDidChangeConfigurationHooks.push(hook);
    return this;
  }

  public addOnInitializeHook(hook: Arg0<IConnection['onInitialize']>) {
    this.onInitializeHooks.push(hook);
    return this;
  }

  public addOnInitializedHook(hook: Arg0<IConnection['onInitialized']>) {
    this.onInitializedHooks.push(hook);
    return this;
  }

  public get server() {
    return this._server;
  }
  public get client() {
    return this._server.client;
  }

  public get docManager() {
    return this._docManager;
  }

  public notifyError(message: string, error?: any): any {
    const cb = (err: any = '') => {
      telemetry.registerException(err, { message, languageServer: true });
      this._server.sendNotification('serverError', { err, message, errMessage: (err.message || err).toString() }); // @TODO: constant
    };
    if (typeof error !== 'undefined') return cb(error);
    return cb;
  }
}

export default SQLToolsLanguageServer;
