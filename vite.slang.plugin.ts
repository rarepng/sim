import {execSync} from 'node:child_process';
import fs from 'node:fs';
import {Plugin} from 'vite';


export function slangwebgpu(): Plugin {
  return {
    name: 'vite.slang.plugin',
    enforce: 'pre',
    load(id: string) {
      if (!id.endsWith('.slang')) return;

      let results: {name: string; code: string;} = {name: '', code: ''};

      const code = execSync(
          `slangc "${
              id}" -target wgsl`,
          {encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']});

      // experimental remover of redefinitions ####(find a better way)####
      const pattern = /(struct\s+\w+\s*\{[\s\S]*?\};|@binding[\s\S]*?;)/g;
      const seen = new Set<string>();

      results = {
        name: id,
        code: code.replace(
            pattern,
            (match: string) => {
              const trim = match.trim();
              if (seen.has(trim)) {
                return '';
              }
              seen.add(trim);
              return match;
            })
      };

      return 'export default ' + JSON.stringify(results) + ';';
    },
  };
}
