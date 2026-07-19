import type { NeuralObservatoryApi } from '../../preload/index'

declare global {
  interface Window {
    neuralObservatory: NeuralObservatoryApi
  }
}

export {}
