import { ILanguageServerPlugin } from '@sqltools/types';
import Redshift from './driver';
import { DRIVER_ALIASES } from './../constants';

const RedshiftDriverPlugin: ILanguageServerPlugin = {
  register(server) {
    DRIVER_ALIASES.forEach(({ value }) => {
      server.getContext().drivers.set(value, Redshift);
    });
  }
}

export default RedshiftDriverPlugin;
