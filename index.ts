// MUST stay first: registers the background GPS job before anything else runs.
import './src/tracking/task';

import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
